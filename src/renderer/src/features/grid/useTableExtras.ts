/**
 * Per-table data that decorates the table browser, separate from row paging:
 * column metadata (enum values), persisted epoch display formats, pager totals
 * (estimate + exact count), and foreign keys for row navigation.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AppError } from '@shared/types/result'
import { asAppError, call } from '@renderer/lib/ipc'
import { useAsync } from '@renderer/lib/useAsync'
import { schemaCache } from '../editor/schemaCache'
import type { ColumnFormat } from './valueFormat'

/** 3214556 → "3.2M", 12345 → "12K", 999 → "999". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

export function useTableExtras(opts: {
  sessionId: string
  connectionId: string | null
  schema: string
  table: string
  where: string
  onError: (e: AppError) => void
}) {
  const { sessionId, connectionId, schema, table, where, onError } = opts

  // Column metadata (enum values, nullability) for type-aware editors, cached per session.
  const meta = useAsync(async () => Object.fromEntries((await schemaCache.getColumns(schema, table)).map((c) => [c.name, c])), [sessionId, schema, table])

  // Per-table display formats (integer epoch → date), remembered across sessions.
  const fmtKey = `colfmt:${connectionId ?? 'adhoc'}:${schema}.${table}`
  const [formats, setFormats] = useState<Record<string, ColumnFormat>>({})
  useEffect(() => {
    void call('prefs:get', { key: fmtKey }).then((v) => setFormats((v as Record<string, ColumnFormat> | null) ?? {}))
  }, [fmtKey])
  const setFormat = (column: string, fmt: ColumnFormat | null): void => {
    const next = { ...formats }
    if (fmt) next[column] = fmt
    else delete next[column]
    setFormats(next)
    void call('prefs:set', { key: fmtKey, value: next })
  }

  // Pager totals: cheap estimate always; exact COUNT(*) on demand, tied to the current filter.
  const estimate = useAsync(() => call('db:countRows', { sessionId, schema, table, exact: false }), [sessionId, schema, table])
  const [exactCount, setExactCount] = useState<{ key: string; n: number | null } | 'loading' | null>(null)
  const countExact = async (): Promise<void> => {
    setExactCount('loading')
    try {
      const r = await call('db:countRows', { sessionId, schema, table, exact: true, where: where || undefined })
      setExactCount({ key: where, n: r.count })
    } catch (e) {
      setExactCount(null)
      onError(asAppError(e))
    }
  }
  const exact = exactCount && exactCount !== 'loading' && exactCount.key === where ? exactCount.n : undefined
  const totalLabel =
    exact !== undefined && exact !== null ? `of ${exact.toLocaleString()}` : !where && estimate.data?.count != null ? `of ~${compactCount(estimate.data.count)}` : null

  // Foreign keys for navigation.
  const fks = useAsync(() => call('db:getForeignKeys', { sessionId, schema, table }), [sessionId, schema, table])
  const fkColumns = useMemo(() => new Set((fks.data?.outgoing ?? []).flatMap((f) => f.columns)), [fks.data])

  return {
    meta: meta.data,
    formats,
    setFormat,
    totalLabel,
    exactKnown: exact !== undefined,
    counting: exactCount === 'loading',
    countExact,
    outgoing: fks.data?.outgoing ?? [],
    incoming: fks.data?.incoming ?? [],
    fkColumns
  }
}
