import { describe, expect, it } from 'vitest'
import { moveCursor, rangeKeys } from './useGridSelection'

describe('moveCursor', () => {
  const c = { row: 2, col: 1 }
  it('moves and clamps', () => {
    expect(moveCursor(c, 'ArrowUp', 5, 3, false)).toEqual({ row: 1, col: 1 })
    expect(moveCursor({ row: 0, col: 0 }, 'ArrowUp', 5, 3, false)).toEqual({ row: 0, col: 0 })
    expect(moveCursor(c, 'ArrowRight', 5, 3, false)).toEqual({ row: 2, col: 2 })
    expect(moveCursor({ row: 2, col: 2 }, 'ArrowRight', 5, 3, false)).toEqual({ row: 2, col: 2 })
  })
  it('jumps with mod and Home/End', () => {
    expect(moveCursor(c, 'ArrowDown', 5, 3, true)).toEqual({ row: 4, col: 1 })
    expect(moveCursor(c, 'End', 5, 3, false)).toEqual({ row: 2, col: 2 })
  })
  it('Tab wraps to next row, Shift+Tab to previous', () => {
    expect(moveCursor({ row: 1, col: 2 }, 'Tab', 5, 3, false)).toEqual({ row: 2, col: 0 })
    expect(moveCursor({ row: 1, col: 0 }, 'ShiftTab', 5, 3, false)).toEqual({ row: 0, col: 2 })
  })
})

describe('rangeKeys', () => {
  it('is inclusive in either direction', () => {
    expect(rangeKeys(3, 1)).toEqual([1, 2, 3])
    expect(rangeKeys(2, 2)).toEqual([2])
  })
})
