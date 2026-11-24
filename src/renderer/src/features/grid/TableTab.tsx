/**
 * Table browser tab: pages rows via db:selectRows (with the FilterBar's
 * WHERE / ORDER BY), stages edits/inserts/deletes client-side, opens the SQL
 * diff drawer on Cmd/Ctrl+S, and shows table details (ⓘ) in TableInfoDrawer.
 *
 * Editing rules: read-only session → no editing at all; no primary key →
 * inserts only (UPDATE/DELETE need a key, ADR-003).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Hash, Info, Lock, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import type { CellValue, StagedChangeset } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { Badge, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { MOD_LABEL, useHotkey } from '@renderer/lib/hotkeys'
import { actions, useAppState } from '@renderer/lib/store'
import { useAsync } from '@renderer/lib/useAsync'
import { DataGrid, type GridRow } from './DataGrid'
import { EMPTY_FILTER, FilterBar, type FilterBarHandle, type TableFilter } from './FilterBar'
import { TableInfoDrawer } from './TableInfoDrawer'
import { SqlDiffDrawer } from './SqlDiffDrawer'
import * as staged from './stagedChanges'
import { formatSort, nextSort, parseSort } from './sortOrder'
import { incomingTargets, outgoingTarget, type FkTarget } from './fkLinks'
import { useTableExtras } from './useTableExtras'


export function TableTab({
  tabId,
  schema,
  table,
  active,
  infoRequest,
  filterRequest
}: {
  tabId: string
  schema: string
  table: string
  active: boolean
  infoRequest?: number
  filterRequest?: { where: string; orderBy?: string; n: number }
}) {
  const session = useAppState((s) => s.session)
  const sessionId = session?.id ?? ''
  const PAGE_SIZE = useAppState((s) => s.settings.pageSize)
  const readOnly = session?.readOnly ?? true
  const [offset, setOffset] = useState(0)
  const [state, setStaged] = useState<staged.StagedState>(staged.emptyStaged)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<StagedChangeset | null>(null)
  const [actionError, setActionError] = useState<AppError | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // A tab opened by FK navigation starts already filtered (no unfiltered round trip first).
  const [filter, setFilter] = useState<TableFilter>(() => (filterRequest ? { where: filterRequest.where, orderBy: filterRequest.orderBy ?? '' } : EMPTY_FILTER))
  const lastFilterRequest = useRef(filterRequest?.n)
  const [infoOpen, setInfoOpen] = useState(false)
  const filterRef = useRef<FilterBarHandle>(null)
  useEffect(() => {
    if (infoRequest) setInfoOpen(true)
  }, [infoRequest])

  const pk = useAsync(() => call('db:getPrimaryKeys', { sessionId, schema, table }), [sessionId, schema, table])
  const x = useTableExtras({ sessionId, connectionId: session?.connectionId ?? null, schema, table, where: filter.where, onError: setActionError })
  const sortState = parseSort(filter.orderBy)

  const page = useAsync(
    () => call('db:selectRows', { sessionId, schema, table, limit: PAGE_SIZE, offset, where: filter.where || undefined, orderBy: filter.orderBy || undefined }),
    [sessionId, schema, table, offset, filter]
  )
  const fields = page.data?.fields ?? []
  const loadedRows = page.data?.rows ?? []
  const hasPk = (pk.data?.length ?? 0) > 0
  const count = staged.changeCount(state)
  useEffect(() => actions.setTabDirty(tabId, count > 0), [tabId, count])

  const gridRows: GridRow[] = useMemo(() => {
    const colIdx = new Map(fields.map((f, i) => [f.name, i]))
    const toIdxRecord = (rec: Record<string, CellValue>): Record<number, CellValue> =>
      Object.fromEntries(Object.entries(rec).map(([k, v]) => [colIdx.get(k) ?? -1, v]))
    const existing = loadedRows.map(
      (values, i): GridRow => ({
        key: `r${i}`,
        values,
        edited: state.edits[i] ? toIdxRecord(state.edits[i]) : undefined,
        status: state.deletes.includes(i) ? 'deleted' : undefined
      })
    )
    const inserted = state.inserts.map(
      (ins): GridRow => ({ key: ins.id, values: fields.map(() => null), edited: toIdxRecord(ins.values), status: 'inserted' })
    )
    return [...existing, ...inserted]
  }, [fields, loadedRows, state])

  const onEditCell = useCallback(
    (row: GridRow, colIndex: number, value: CellValue) => {
      const column = fields[colIndex]?.name
      if (!column) return
      if (row.status === 'inserted') setStaged((s) => staged.editInsert(s, row.key, column, value))
      else {
        const i = Number(row.key.slice(1))
        setStaged((s) => staged.stageEdit(s, i, column, value, loadedRows[i]?.[colIndex] ?? null))
      }
    },
    [fields, loadedRows]
  )

  const openReview = (): void => {
    if (count === 0) return
    try {
      setActionError(null)
      setDrawer(staged.buildChangeset(state, { schema, table, fields, rows: loadedRows, primaryKey: pk.data ?? [] }))
    } catch (err) {
      setActionError(asAppError(err))
    }
  }
  useHotkey('mod+s', openReview, active)
  useHotkey('mod+f', () => filterRef.current?.focus(), active)
  // Native menu: Query → Review Staged Changes / Filter Rows (active tab only).
  const tabCommand = useAppState((s) => s.tabCommand)
  const seenCommand = useRef(tabCommand?.n)
  useEffect(() => {
    if (!active || !tabCommand || tabCommand.n === seenCommand.current) return
    seenCommand.current = tabCommand.n
    if (tabCommand.id === 'reviewChanges') openReview()
    if (tabCommand.id === 'focusFilter') filterRef.current?.focus()
  }, [tabCommand, active]) // eslint-disable-line react-hooks/exhaustive-deps
  // FK navigation into an already-open tab re-filters it.
  useEffect(() => {
    if (!filterRequest || filterRequest.n === lastFilterRequest.current) return
    lastFilterRequest.current = filterRequest.n
    applyFilter({ where: filterRequest.where, orderBy: filterRequest.orderBy ?? '' })
  }, [filterRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  const follow = (t: FkTarget | null): void => {
    if (t) actions.openTable(t.schema, t.table, { where: t.where })
  }

  const applyFilter = (f: TableFilter): void => {
    // Staged edits point at rows by position in the loaded page, so the row set must not change under them.
    if (count > 0) return setActionError({ code: 'VALIDATION', message: 'Commit or discard staged changes before filtering.' })
    setActionError(null)
    setOffset(0)
    setFilter(f)
    actions.setTableFilter(tabId, f) // persisted with the workspace
  }

  /** Stage deletes for existing rows (needs a PK) and drop staged inserts. */
  const deleteRows = (targets: GridRow[]): void => {
    setStaged((s) =>
      targets.reduce((acc, r) => {
        if (r.status === 'inserted') return staged.removeInsert(acc, r.key)
        if (!hasPk) return acc
        const i = Number(r.key.slice(1))
        return acc.deletes.includes(i) ? acc : staged.toggleDelete(acc, i)
      }, s)
    )
  }

  const deleteSelected = (): void => {
    if (!selectedKey) return
    if (selectedKey.startsWith('new-')) setStaged((s) => staged.removeInsert(s, selectedKey))
    else if (hasPk) setStaged((s) => staged.toggleDelete(s, Number(selectedKey.slice(1))))
  }

  const changePage = (next: number): void => {
    if (count > 0) return setActionError({ code: 'VALIDATION', message: 'Commit or discard staged changes before changing page.' })
    setOffset(Math.max(0, next))
  }

  const editable = !readOnly
  const canEdit = (row: GridRow): boolean => row.status !== 'deleted' && (row.status === 'inserted' || hasPk)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {schema}.<span className="text-foreground">{table}</span>
        </span>
        {!hasPk && pk.data && <Badge tone="amber">no primary key: insert only</Badge>}
        {readOnly && (
          <Badge tone="neutral">
            <Lock className="mr-0.5 size-2.5" /> read-only
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editable && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setStaged((s) => staged.addInsert(s))}>
                <Plus /> Row
              </Button>
              <Button size="sm" variant="ghost" onClick={deleteSelected} disabled={!selectedKey || (!hasPk && !selectedKey.startsWith('new-'))}>
                <Trash2 /> Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStaged(staged.emptyStaged)} disabled={count === 0}>
                <Undo2 /> Discard
              </Button>
              <Button size="sm" variant={count ? 'default' : 'outline'} onClick={openReview} disabled={count === 0}>
                Review {count > 0 && `(${count})`} <kbd className="ml-1 text-[10px] opacity-70">{MOD_LABEL}S</kbd>
              </Button>
            </>
          )}
          <span className="mx-1 h-4 w-px bg-border" />
          <Button size="icon" variant="ghost" onClick={() => changePage(offset - PAGE_SIZE)} disabled={offset === 0} title="Previous page">
            <ChevronLeft />
          </Button>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {offset + 1}–{offset + loadedRows.length} {x.totalLabel}
          </span>
          {!x.exactKnown && (
            <Button size="sm" variant="ghost" onClick={() => void x.countExact()} disabled={x.counting} title="Count rows exactly (COUNT(*) with the current filter)">
              {x.counting ? <Spinner /> : <Hash />} Count
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => changePage(offset + PAGE_SIZE)} disabled={loadedRows.length < PAGE_SIZE} title="Next page">
            <ChevronRight />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void page.reload()} disabled={count > 0} title="Reload">
            {page.loading ? <Spinner /> : <RefreshCw />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setInfoOpen(true)} title="Table info: DDL, indexes, constraints, stats">
            <Info />
          </Button>
        </div>
      </div>
      <FilterBar ref={filterRef} applied={filter} fields={fields} onApply={applyFilter} disabledReason={count > 0 ? 'Commit or discard staged changes first' : undefined} />
      {(page.error || pk.error || actionError) && (
        <div className="p-2">
          <ErrorBanner
            error={(page.error ?? pk.error ?? actionError) as AppError}
            onRetry={() => {
              void pk.reload()
              void page.reload()
            }}
          />
        </div>
      )}
      {flash && <div className="border-b bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-600 dark:text-emerald-300">{flash}</div>}
      <div className="min-h-0 flex-1">
        <DataGrid
          fields={fields}
          rows={gridRows}
          onEditCell={editable ? onEditCell : undefined}
          canEdit={canEdit}
          onSelectRow={(r) => setSelectedKey(r?.key ?? null)}
          onDeleteRows={editable ? deleteRows : undefined}
          menu={{
            table: { schema, table },
            onFilter: (where) => applyFilter({ where, orderBy: filter.orderBy }),
            onSort: (column, dir) => applyFilter({ where: filter.where, orderBy: formatSort({ column, dir }) }),
            formatOf: (column) => x.formats[column],
            cellLinks: (column, row) => {
              const out = outgoingTarget(column, row, x.outgoing)
              return [...(out ? [out] : []), ...incomingTargets(column, row, x.incoming)].map((t) => ({ label: t.label, run: () => follow(t) }))
            },
            onSetFormat: x.setFormat
          }}
          sort={sortState}
          columnMeta={x.meta}
          fkColumns={x.fkColumns}
          onFollowFk={(column, row) => follow(outgoingTarget(column, row, x.outgoing))}
          columnFormats={x.formats}
          onSortClick={(column) => applyFilter({ where: filter.where, orderBy: formatSort(nextSort(sortState, column)) })}
          emptyText={page.loading ? 'Loading…' : filter.where ? 'No rows match the filter' : 'Table is empty'}
        />
      </div>
      <TableInfoDrawer open={infoOpen} onOpenChange={setInfoOpen} sessionId={sessionId} schema={schema} table={table} />
      <SqlDiffDrawer
        open={drawer !== null}
        onOpenChange={(o) => !o && setDrawer(null)}
        sessionId={sessionId}
        changeset={drawer}
        onCommitted={(rows) => {
          setStaged(staged.emptyStaged)
          setFlash(`Committed. ${rows} row(s) affected.`)
          setTimeout(() => setFlash(null), 4000)
          void page.reload()
        }}
      />
    </div>
  )
}

