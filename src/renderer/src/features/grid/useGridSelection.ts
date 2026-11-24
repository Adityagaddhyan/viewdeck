/**
 * Cell cursor + row selection for DataGrid.
 * - Click: cursor on that cell, selects its row.
 * - Cmd/Ctrl+click: toggle the row. Shift+click: range from the anchor row.
 * - Arrows / Tab / Shift+Tab move the cursor. Shift+Up/Down extends the row range.
 * - Home/End jump to first/last column. Cmd/Ctrl+Up/Down jump to first/last row.
 * - Cmd/Ctrl+A selects all rows.
 * Pure state transitions live in `moveCursor` / `rangeKeys` (unit-tested).
 */
import { useCallback, useState } from 'react'

export interface Cursor {
  row: number
  col: number
}

export function moveCursor(c: Cursor, key: string, rows: number, cols: number, jump: boolean): Cursor {
  const clampR = (r: number): number => Math.max(0, Math.min(rows - 1, r))
  const clampC = (x: number): number => Math.max(0, Math.min(cols - 1, x))
  switch (key) {
    case 'ArrowUp':
      return { ...c, row: jump ? 0 : clampR(c.row - 1) }
    case 'ArrowDown':
      return { ...c, row: jump ? rows - 1 : clampR(c.row + 1) }
    case 'ArrowLeft':
      return { ...c, col: clampC(c.col - 1) }
    case 'ArrowRight':
      return { ...c, col: clampC(c.col + 1) }
    case 'Home':
      return { ...c, col: 0 }
    case 'End':
      return { ...c, col: cols - 1 }
    case 'Tab':
      return c.col < cols - 1 ? { ...c, col: c.col + 1 } : { row: clampR(c.row + 1), col: 0 }
    case 'ShiftTab':
      return c.col > 0 ? { ...c, col: c.col - 1 } : { row: clampR(c.row - 1), col: cols - 1 }
    default:
      return c
  }
}

/** Row indices from a to b inclusive, in either direction. */
export function rangeKeys(a: number, b: number): number[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

export function useGridSelection(rowCount: number, colCount: number) {
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)

  const clickCell = useCallback(
    (row: number, col: number, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      setCursor({ row, col })
      if (e.shiftKey && anchor !== null) setSelected(new Set(rangeKeys(anchor, row)))
      else if (e.metaKey || e.ctrlKey) {
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(row)) n.delete(row)
          else n.add(row)
          return n
        })
        setAnchor(row)
      } else {
        setSelected(new Set([row]))
        setAnchor(row)
      }
    },
    [anchor]
  )

  /** Returns true if the key was handled (caller should preventDefault). */
  const handleNavKey = useCallback(
    (e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean => {
      if (rowCount === 0 || colCount === 0) return false
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'a') {
        setSelected(new Set(rangeKeys(0, rowCount - 1)))
        return true
      }
      const key = e.key === 'Tab' && e.shiftKey ? 'ShiftTab' : e.key
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'ShiftTab'].includes(key)) return false
      const from = cursor ?? { row: 0, col: 0 }
      const next = cursor ? moveCursor(from, key, rowCount, colCount, mod) : from
      setCursor(next)
      if (e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const a = anchor ?? from.row
        setAnchor(a)
        setSelected(new Set(rangeKeys(a, next.row)))
      } else if (next.row !== from.row || !cursor) {
        setSelected(new Set([next.row]))
        setAnchor(next.row)
      }
      return true
    },
    [cursor, anchor, rowCount, colCount]
  )

  const reset = useCallback(() => {
    setCursor(null)
    setSelected(new Set())
    setAnchor(null)
  }, [])

  return { cursor, setCursor, selected, setSelected, clickCell, handleNavKey, reset }
}
