import { describe, expect, it } from 'vitest'
import type { CellValue, QueryField } from '@shared/types/driver'
import { compileFilter } from './resultFilter'

const fields: QueryField[] = [
  { name: 'id', dataType: 'bpchar' },
  { name: 'status', dataType: 'text' },
  { name: 'amount', dataType: 'numeric' },
  { name: 'created_at', dataType: 'int8' },
  { name: 'active', dataType: 'bool' },
  { name: 'Mixed Case', dataType: 'text' }
]
const rows: CellValue[][] = [
  ['a1', 'shipped', '10.50', '1795441477866', true, 'x'],
  ['b2', 'pending', '200', '1795447006660', false, null],
  ['c3', null, null, '1795430043828', true, 'y'],
  ['d4', 'Split_Done', '-5', '1795447232746', null, 'z']
]
const ids = (where: string): string[] | 'invalid' => {
  const f = compileFilter(where, fields)
  return f.ok ? rows.filter((r) => f.test(r)).map((r) => r[0] as string) : 'invalid'
}

describe('compileFilter', () => {
  it('compares text and numeric-text (int8 / numeric arrive as strings) correctly', () => {
    expect(ids("status = 'shipped'")).toEqual(['a1'])
    expect(ids('amount > 20')).toEqual(['b2'])
    expect(ids('amount < 0')).toEqual(['d4'])
    expect(ids('created_at >= 1795447006660')).toEqual(['b2', 'd4'])
    expect(ids("status <> 'shipped'")).toEqual(['b2', 'd4']) // NULL is unknown, not "not equal"
  })
  it('handles AND / OR / NOT, parentheses and an optional leading WHERE', () => {
    expect(ids("WHERE (status = 'shipped' or status = 'pending') and amount > 100")).toEqual(['b2'])
    expect(ids("not status = 'pending'")).toEqual(['a1', 'd4'])
    expect(ids('active and amount > 0')).toEqual(['a1'])
  })
  it('supports IS NULL / IS TRUE, LIKE / ILIKE, regex, IN, BETWEEN', () => {
    expect(ids('status is null')).toEqual(['c3'])
    expect(ids('active is not true')).toEqual(['b2', 'd4'])
    expect(ids("status ilike '%split%'")).toEqual(['d4'])
    expect(ids("status like 'Split\\_%'")).toEqual([]) // only % and _ are wildcards; backslash is literal here
    expect(ids("status not like 's%'")).toEqual(['b2', 'd4'])
    expect(ids("status ~* '^sh'")).toEqual(['a1'])
    expect(ids("id in ('a1', 'c3')")).toEqual(['a1', 'c3'])
    expect(ids("id not in ('a1', 'c3')")).toEqual(['b2', 'd4'])
    expect(ids('amount between 0 and 100')).toEqual(['a1'])
  })
  it('supports arithmetic, functions, casts and quoted / case-insensitive columns', () => {
    expect(ids('created_at / 1000 < 1795440000')).toEqual(['c3'])
    expect(ids("lower(status) = 'split_done'")).toEqual(['d4'])
    expect(ids("coalesce(status, 'none') = 'none'")).toEqual(['c3'])
    expect(ids("amount::numeric > 100")).toEqual(['b2'])
    expect(ids('"Mixed Case" = \'y\'')).toEqual(['c3'])
    expect(ids("STATUS = 'pending'")).toEqual(['b2'])
    expect(ids("status || '!' = 'pending!'")).toEqual(['b2'])
  })
  it('is invalid (no filter) for incomplete input, unknown columns or non-boolean expressions', () => {
    for (const w of ['', '   ', "status = 'sh", 'status =', 'amount >', 'nope = 1', 'id', 'amount + 1', 'status in (', '(status', 'select 1', "status = 'a'; drop table x"]) {
      expect(ids(w), w).toBe('invalid')
    }
  })
})
