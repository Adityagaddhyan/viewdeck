/**
 * Pure model for "compare rows": aligns two row snapshots by column name
 * (they may come from different tables, tabs or query results) and marks which
 * values differ. Values compare by their displayed text, so 1 and '1' (a
 * numeric kept as a string) are equal.
 */
import type { CellValue } from '@shared/types/driver'
import { cellText } from './copyFormats'

/** A row captured for comparison (pinned, or one of two selected rows). */
export interface RowSnapshot {
  /** Where it came from, e.g. "public.orders" or "Query 2". */
  label: string
  columns: string[]
  values: CellValue[]
}

export interface CompareLine {
  column: string
  /** undefined = the column doesn't exist on that side. */
  a: CellValue | undefined
  b: CellValue | undefined
  same: boolean
}

/** Union of columns (A's order, then B-only columns), each with both values. */
export function compareRows(a: RowSnapshot, b: RowSnapshot): CompareLine[] {
  const bIndex = new Map(b.columns.map((c, i) => [c, i]))
  const lines: CompareLine[] = a.columns.map((column, i) => {
    const j = bIndex.get(column)
    const av = a.values[i]
    const bv = j === undefined ? undefined : b.values[j]
    return { column, a: av, b: bv, same: j !== undefined && sameValue(av, bv) }
  })
  const aCols = new Set(a.columns)
  b.columns.forEach((column, j) => {
    if (!aCols.has(column)) lines.push({ column, a: undefined, b: b.values[j], same: false })
  })
  return lines
}

function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a === null || b === null) return a === b
  return cellText(a) === cellText(b)
}
