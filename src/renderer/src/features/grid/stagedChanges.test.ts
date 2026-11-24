import { describe, expect, it } from 'vitest'
import { addInsert, buildChangeset, changeCount, coerceInput, editInsert, emptyStaged, stageEdit, toggleDelete } from './stagedChanges'

const ctx = {
  schema: 'public',
  table: 'orders',
  fields: [
    { name: 'id', dataType: 'int4' },
    { name: 'status', dataType: 'text' }
  ],
  rows: [
    [1, 'new'],
    [2, 'new'],
    [3, 'new']
  ],
  primaryKey: ['id']
}

describe('stagedChanges', () => {
  it('reverting an edit to its original value unstages it', () => {
    let s = stageEdit(emptyStaged, 0, 'status', 'paid', 'new')
    expect(changeCount(s)).toBe(1)
    s = stageEdit(s, 0, 'status', 'new', 'new')
    expect(s.edits).toEqual({})
  })

  it('builds updates keyed by ORIGINAL pk values, inserts, and deletes', () => {
    let s = stageEdit(emptyStaged, 0, 'id', 100, 1) // editing the PK itself
    s = stageEdit(s, 0, 'status', 'paid', 'new')
    s = stageEdit(s, 1, 'status', 'x', 'new')
    s = toggleDelete(s, 1) // delete supersedes edit
    s = toggleDelete(s, 2)
    s = addInsert(s)
    s = editInsert(s, s.inserts[0]!.id, 'status', 'fresh')
    expect(changeCount(s)).toBe(4)
    expect(buildChangeset(s, ctx).changes).toEqual([
      { kind: 'update', key: { id: 1 }, values: { id: 100, status: 'paid' } },
      { kind: 'insert', values: { status: 'fresh' } },
      { kind: 'delete', key: { id: 2 } },
      { kind: 'delete', key: { id: 3 } }
    ])
  })

  it('toggleDelete twice restores the row', () => {
    expect(toggleDelete(toggleDelete(emptyStaged, 1), 1).deletes).toEqual([])
  })

  it('refuses keyed changes on tables without a primary key', () => {
    const s = toggleDelete(emptyStaged, 0)
    expect(() => buildChangeset(s, { ...ctx, primaryKey: [] })).toThrow(/no primary key/)
    expect(buildChangeset(addInsert(emptyStaged), { ...ctx, primaryKey: [] }).changes).toHaveLength(1)
  })
})

describe('coerceInput', () => {
  it.each([
    ['42', 'int4', 42],
    ['9007199254740993', 'int8', '9007199254740993'],
    ['1.50', 'numeric(10,2)', '1.50'],
    ['2.5', 'float8', 2.5],
    ['abc', 'int4', 'abc'],
    ['true', 'bool', true],
    ['f', 'boolean', false],
    ['', 'text', ''],
    ['2026-01-01', 'date', '2026-01-01']
  ] as const)('%s as %s', (text, type, out) => {
    expect(coerceInput(text, type)).toBe(out)
  })
})
