/**
 * Header-click sorting for the table browser. The sort lives in the filter
 * bar's ORDER BY text (visible and editable), and these helpers translate both
 * ways. Pure, unit-tested.
 */
export interface SortState {
  column: string
  dir: 'asc' | 'desc'
}

const QUOTED = /^"((?:[^"]|"")+)"\s+(asc|desc)$/i
const BARE = /^([A-Za-z_][A-Za-z0-9_$]*)(?:\s+(asc|desc))?$/i

/** Recognises a single-column ORDER BY produced by (or compatible with) header clicks. */
export function parseSort(orderBy: string): SortState | null {
  const t = orderBy.trim()
  const q = QUOTED.exec(t)
  if (q?.[1]) return { column: q[1].replace(/""/g, '"'), dir: (q[2] ?? 'asc').toLowerCase() as SortState['dir'] }
  const b = BARE.exec(t)
  if (b?.[1]) return { column: b[1].toLowerCase(), dir: (b[2] ?? 'asc').toLowerCase() as SortState['dir'] }
  return null
}

export function formatSort(s: SortState | null): string {
  return s ? `"${s.column.replace(/"/g, '""')}" ${s.dir.toUpperCase()}` : ''
}

/** Click cycle on a header: none → asc → desc → none. Another column starts at asc. */
export function nextSort(current: SortState | null, column: string): SortState | null {
  if (!current || current.column !== column) return { column, dir: 'asc' }
  return current.dir === 'asc' ? { column, dir: 'desc' } : null
}
