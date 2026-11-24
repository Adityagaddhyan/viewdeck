import { describe, expect, it } from 'vitest'
import { compareRows } from './compareRows'

describe('compareRows', () => {
  it('aligns by column name and flags differences', () => {
    const lines = compareRows(
      { label: 'A', columns: ['id', 'status', 'note'], values: [1, 'paid', null] },
      { label: 'B', columns: ['status', 'id', 'extra'], values: ['open', '1', 'x'] }
    )
    expect(lines).toEqual([
      { column: 'id', a: 1, b: '1', same: true },
      { column: 'status', a: 'paid', b: 'open', same: false },
      { column: 'note', a: null, b: undefined, same: false },
      { column: 'extra', a: undefined, b: 'x', same: false }
    ])
  })

  it('NULL only equals NULL (not the empty string)', () => {
    const [line] = compareRows({ label: 'A', columns: ['v'], values: [null] }, { label: 'B', columns: ['v'], values: [''] })
    expect(line?.same).toBe(false)
    const [both] = compareRows({ label: 'A', columns: ['v'], values: [null] }, { label: 'B', columns: ['v'], values: [null] })
    expect(both?.same).toBe(true)
  })
})
