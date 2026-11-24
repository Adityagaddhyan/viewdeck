/**
 * Results area of a query tab: status line (command, rows, duration, elapsed
 * while running), Export menu (copy as TSV / CSV / JSON / Markdown, save CSV /
 * JSON), error banner, and the read-only results grid.
 *
 * A multi-statement run ("Run all") passes `steps`: the strip then shows an
 * **All** tab (every statement's SQL and output stacked like a terminal, see
 * ScriptOutputView) plus one tab per statement, and "Copy all" copies them all.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { QueryResult } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Badge, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { copyText } from '@renderer/lib/clipboard'
import { asAppError, call } from '@renderer/lib/ipc'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { actions } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { DataGrid } from '../grid/DataGrid'
import { toCsv, toJson, toMarkdown, toTsv } from '../grid/copyFormats'
import { CopyAllMenu, ScriptOutputView } from './ScriptOutputView'
import type { ScriptStep } from './scriptOutput'
import { ResultToolbar, type ResultToolbarHandle } from './ResultToolbar'
import { useResultFilter } from './useResultFilter'

/** Imperative handle: ⌘F from the query tab focuses find-in-results. */
export interface QueryResultsHandle {
  focusFind: () => void
}

/** Index of the All tab in a script run. */
const ALL = -1

export const QueryResults = forwardRef<QueryResultsHandle, {
  result: QueryResult | null
  /** Statements of a multi-statement run, in order (grows while it runs). */
  steps: ScriptStep[] | null
  /** Statement count of the running script, for "Running 3/7". */
  total: number
  running: boolean
  elapsed: number
  error: AppError | null
  onRetry: () => void
}>(function QueryResults({ result, steps, total, running, elapsed, error, onRetry }, ref) {
  const [active, setActive] = useState(ALL)
  // Back to All whenever a new run starts (steps reset to null or []).
  useEffect(() => setActive(ALL), [!steps || steps.length === 0]) // eslint-disable-line react-hooks/exhaustive-deps
  const step = steps && active !== ALL ? (steps[active] ?? null) : null
  const res = steps ? (step?.result ?? null) : result
  const shownError = steps ? (step?.error ?? null) : error
  const view = useResultFilter(res)
  const rows = view.rows
  /** What Export copies / saves: the filtered rows when a filter is applied. */
  const exportRows = view.applied ? rows.map((r) => r.values) : (res?.rows ?? [])
  const toolbarRef = useRef<ResultToolbarHandle>(null)
  useImperativeHandle(ref, () => ({
    focusFind: () => {
      if (steps && active === ALL) {
        // The All view is plain text: jump to the first result grid, then find there.
        const first = steps.findIndex((s) => (s.result?.fields.length ?? 0) > 0)
        if (first < 0) return
        setActive(first)
        requestAnimationFrame(() => toolbarRef.current?.focusFind())
      } else toolbarRef.current?.focusFind()
    }
  }))
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  const save = async (kind: 'csv' | 'json'): Promise<void> => {
    if (!res) return
    try {
      const { path } = await call('app:saveFile', { defaultName: `query-${stamp}.${kind}`, content: kind === 'csv' ? toCsv(res.fields, exportRows) : toJson(res.fields, exportRows) })
      if (path) actions.showToast(`Saved ${path.split('/').pop()}`)
    } catch (e) {
      actions.showToast(`Export failed: ${asAppError(e).message}`)
    }
  }

  const tab = (i: number, label: React.ReactNode, failed = false) => (
    <button key={i} onClick={() => setActive(i)} className={cn('shrink-0 rounded px-1.5 py-0.5', i === active ? 'bg-accent text-foreground' : 'hover:text-foreground', failed && 'text-red-500')}>
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 overflow-x-auto border-b px-2 text-[11px] text-muted-foreground">
        {running && (
          <>
            <Spinner /> Running{steps && total > 1 ? ` ${Math.min(steps.length + 1, total)}/${total}` : ''}… <span className="font-mono tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
          </>
        )}
        {steps && (
          <>
            {tab(ALL, 'All')}
            {steps.map((s, i) => tab(i, <>{i + 1} <span className="opacity-60">{s.error ? 'ERROR' : s.result?.command || 'OK'}</span></>, !!s.error))}
          </>
        )}
        {res && !running && (
          <>
            {!steps && <Badge>{res.command || 'OK'}</Badge>}
            <span>{res.fields.length > 0 ? `${res.rows.length.toLocaleString()} rows` : `${res.rowCount.toLocaleString()} rows affected`}</span>
            <span>· {res.durationMs} ms</span>
            {res.truncated && <Badge tone="amber">truncated to {res.rows.length.toLocaleString()}</Badge>}
            {res.fields.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className={cn('h-6', !steps && 'ml-auto')}>
                    <Download /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Copy {exportRows.length.toLocaleString()}{view.applied ? ' filtered' : ''} rows as</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => void copyText(toTsv(res.fields, exportRows, true), 'Copied as TSV')}>TSV (spreadsheet)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyText(toCsv(res.fields, exportRows), 'Copied as CSV')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyText(toJson(res.fields, exportRows), 'Copied as JSON')}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyText(toMarkdown(res.fields, exportRows), 'Copied as Markdown')}>Markdown</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void save('csv')}>Save as CSV…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void save('json')}>Save as JSON…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
        {steps && steps.length > 0 && !running && <CopyAllMenu steps={steps} />}
        {!res && !steps && !running && !error && <span>{MOD_LABEL}Enter runs the statement under the cursor, or the selection. Run runs every statement.</span>}
      </div>
      {shownError && (
        <div className="p-2">
          <ErrorBanner error={shownError} onRetry={onRetry} />
        </div>
      )}
      {res && res.fields.length > 0 && !(steps && active === ALL) && (
        <ResultToolbar
          ref={toolbarRef}
          fields={res.fields}
          filter={view.filter}
          onFilter={view.setFilter}
          filterApplied={view.applied}
          shown={rows.length}
          total={res.rows.length}
          find={view.find}
          onFind={view.setFind}
          matchCount={view.matches.length}
          matchIndex={view.matchIndex}
          onStep={view.step}
        />
      )}
      <div className="min-h-0 flex-1">
        {steps && active === ALL ? (
          <ScriptOutputView steps={steps} />
        ) : (
          res &&
          res.fields.length > 0 && (
            <DataGrid
              fields={res.fields}
              rows={rows}
              highlight={view.highlight}
              focusCell={view.focusCell}
              emptyText={view.applied ? 'No rows match the filter' : 'Query returned no rows'}
            />
          )
        )}
      </div>
    </div>
  )
})
