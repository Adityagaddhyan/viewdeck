import { describe, expect, it } from 'vitest'
import { cellText, parseJsonCell, toCsv, toInsert, toJson, toMarkdown, toTsv, toWhere } from './copyFormats'

const fields = [
  { name: 'id', dataType: 'int8' },
  { name: 'note', dataType: 'text' },
  { name: 'meta', dataType: 'jsonb' },
  { name: 'ok', dataType: 'bool' }
]
const rows = [
  ['9007199254740993', `it's "fine", ok`, '{"a": [1, 2]}', true],
  ['2', null, null, false]
]

describe('copyFormats', () => {
  it('cellText: NULL is empty', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(false)).toBe('false')
  })

  it('TSV / CSV quote only when needed', () => {
    expect(toTsv(fields, [rows[1]!])).toBe('2\t\t\tfalse')
    expect(toCsv(fields, rows)).toBe(
      ['id,note,meta,ok', `9007199254740993,"it's ""fine"", ok","{""a"": [1, 2]}",true`, '2,,,false'].join('\n')
    )
  })

  it('JSON embeds json columns, keeps int8 exact, single row → object', () => {
    expect(JSON.parse(toJson(fields, [rows[0]!]))).toEqual({ id: '9007199254740993', note: `it's "fine", ok`, meta: { a: [1, 2] }, ok: true })
    expect(JSON.parse(toJson(fields, rows))).toHaveLength(2)
  })

  it('Markdown escapes pipes and newlines', () => {
    expect(toMarkdown([{ name: 'x', dataType: 'text' }], [['a|b\nc']])).toBe('| x |\n| --- |\n| a\\|b<br>c |')
  })

  it('INSERT quotes identifiers and literals; numbers unquoted', () => {
    expect(toInsert({ schema: 'shop', table: 'Orders' }, fields, [rows[0]!])).toBe(
      `INSERT INTO "shop"."Orders" ("id", "note", "meta", "ok") VALUES (9007199254740993, 'it''s "fine", ok', '{"a": [1, 2]}', TRUE);`
    )
  })

  it('WHERE handles NULL and quoting', () => {
    expect(toWhere(fields[1]!, null)).toBe('"note" IS NULL')
    expect(toWhere(fields[1]!, "o'k")).toBe(`"note" = 'o''k'`)
    expect(toWhere(fields[0]!, '42')).toBe('"id" = 42')
  })

  it('parseJsonCell detects json columns and JSON-looking text only', () => {
    expect(parseJsonCell('{"a":1}', 'jsonb')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonCell('[1,2]', 'text')).toEqual({ ok: true, value: [1, 2] })
    expect(parseJsonCell('{a,b}', '_text')).toEqual({ ok: false }) // Postgres array literal
    expect(parseJsonCell('hello', 'text')).toEqual({ ok: false })
  })
})
