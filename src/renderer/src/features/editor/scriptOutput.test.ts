import { describe, expect, it } from 'vitest'
import type { QueryResult } from '@shared/types/driver'
import { commandSummary, formatScript, stepText, toAligned, type ScriptStep } from './scriptOutput'

const res = (over: Partial<QueryResult>): QueryResult => ({ fields: [], rows: [], rowCount: 0, command: 'SELECT', durationMs: 1, truncated: false, ...over })
const select: ScriptStep = {
  sql: 'select id, name from t',
  result: res({ fields: [{ name: 'id', dataType: 'int4' }, { name: 'name', dataType: 'text' }], rows: [[1, 'alice'], [22, null]], rowCount: 2 }),
  error: null
}
const update: ScriptStep = { sql: 'update t set x = 1', result: res({ command: 'UPDATE', rowCount: 3 }), error: null }
const failed: ScriptStep = { sql: 'select * from nope', result: null, error: { code: 'DB_QUERY_FAILED', message: 'relation "nope" does not exist' } }

describe('toAligned', () => {
  it('pads columns like psql and prints NULL as empty', () => {
    expect(toAligned(select.result!.fields, select.result!.rows)).toBe([' id | name', '----+-------', ' 1  | alice', ' 22 |', '(2 rows)'].join('\n'))
  })
  it('keeps multi-line cells on one row and says "1 row"', () => {
    expect(toAligned([{ name: 'v', dataType: 'text' }], [['a\nb']])).toBe([' v', '------', ' a\\nb', '(1 row)'].join('\n'))
  })
})

describe('commandSummary', () => {
  it('adds the row count for DML only', () => {
    expect(commandSummary(res({ command: 'DELETE', rowCount: 4 }))).toBe('DELETE 4')
    expect(commandSummary(res({ command: 'CREATE TABLE' }))).toBe('CREATE TABLE')
    expect(commandSummary(res({ command: '' }))).toBe('OK')
  })
})

describe('formatScript', () => {
  it('markdown: sql block then table, command tag or error per step', () => {
    const md = formatScript([select, update, failed], 'markdown')
    expect(md).toContain('```sql\nselect id, name from t\n```\n\n| id | name |\n| --- | --- |\n| 1 | alice |\n| 22 |  |\n\n(2 rows)')
    expect(md).toContain('```sql\nupdate t set x = 1\n```\n\nUPDATE 3')
    expect(md).toContain('ERROR: relation "nope" does not exist')
  })
  it('text: terminal-style transcript', () => {
    const txt = formatScript([select, failed], 'text')
    expect(txt.startsWith('select id, name from t;\n id | name\n')).toBe(true)
    expect(txt).toContain('\n\nselect * from nope;\nERROR: relation "nope" does not exist')
  })
  it('json: one entry per statement', () => {
    const parsed = JSON.parse(formatScript([select, update, failed], 'json'))
    expect(parsed[0]).toEqual({ sql: select.sql, command: 'SELECT', rowCount: 2, rows: [{ id: 1, name: 'alice' }, { id: 22, name: null }], truncated: false, error: null })
    expect(parsed[1].rows).toBeNull()
    expect(parsed[2]).toMatchObject({ command: null, error: 'relation "nope" does not exist' })
  })
  it('notes truncated results', () => {
    const t: ScriptStep = { ...select, result: { ...select.result!, truncated: true } }
    expect(stepText(t)).toContain('(truncated: only the first 2 rows were fetched)')
  })
})
