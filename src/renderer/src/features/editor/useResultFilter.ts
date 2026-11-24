/**
 * State for the result toolbar: the live WHERE filter (client-side, see
 * `grid/resultFilter.ts`) and find-in-results (matching cells, current match,
 * cursor jumps). Filter text survives re-runs, so editing the query and
 * running again keeps the same view ("hot reload" of the filtered output).
 */
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { QueryResult } from '@shared/types/driver'
import type { GridRow } from '../grid/DataGrid'
import { compileFilter } from '../grid/resultFilter'

/** Find stops counting after this many matching cells (keeps huge results responsive). */
const MAX_MATCHES = 10_000

export function useResultFilter(res: QueryResult | null) {
  const [filter, setFilter] = useState('')
  const [find, setFind] = useState('')
  const [matchIndex, setMatchIndex] = useState(-1)
  const [focusCell, setFocusCell] = useState<{ row: number; col: number; n: number } | null>(null)
  const deferredFilter = useDeferredValue(filter)
  const deferredFind = useDeferredValue(find)

  const compiled = useMemo(() => (res ? compileFilter(deferredFilter, res.fields) : { ok: false as const }), [res, deferredFilter])
  const applied: boolean | null = deferredFilter.trim() === '' ? null : compiled.ok

  const rows: GridRow[] = useMemo(() => {
    if (!res) return []
    const all = res.rows.map((values, i) => ({ key: `q${i}`, values }))
    return compiled.ok ? all.filter((r) => compiled.test(r.values)) : all
  }, [res, compiled])

  const needle = deferredFind.trim().toLowerCase()
  const matches = useMemo(() => {
    const out: Array<{ row: number; col: number }> = []
    if (!needle) return out
    for (let ri = 0; ri < rows.length && out.length < MAX_MATCHES; ri++) {
      const vals = rows[ri]!.values
      for (let ci = 0; ci < vals.length; ci++) {
        const v = vals[ci]
        if (v !== null && v !== undefined && String(v).toLowerCase().includes(needle)) out.push({ row: ri, col: ci })
      }
    }
    return out
  }, [rows, needle])

  const goTo = (i: number): void => {
    const m = matches[i]
    if (!m) return
    setMatchIndex(i)
    setFocusCell((f) => ({ ...m, n: (f?.n ?? 0) + 1 }))
  }
  // Typing jumps to the first match, like a browser's find.
  useEffect(() => {
    if (matches.length) goTo(0)
    else setMatchIndex(-1)
  }, [matches]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: 1 | -1): void => {
    if (!matches.length) return
    goTo((matchIndex + dir + matches.length) % matches.length)
  }

  return { filter, setFilter, applied, rows, find, setFind, highlight: needle, matches, matchIndex, step, focusCell }
}
