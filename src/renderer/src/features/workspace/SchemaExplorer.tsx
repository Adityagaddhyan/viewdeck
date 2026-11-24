/** Sidebar tree: schemas → tables/views, lazily loaded, with a filter box. */
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ClipboardCopy, Code2, Copy, Eye, Info, Layers, Network, RefreshCw, Search, Table2 } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { copyText } from '@renderer/lib/clipboard'
import { quoteIfNeeded } from '../editor/completionContext'
import { compactCount } from '../grid/useTableExtras'
import { SchemaObjectsGroups } from './SchemaObjectsGroup'
import type { TableInfo } from '@shared/types/driver'
import { Input, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { actions, useAppState } from '@renderer/lib/store'
import { asAppError } from '@renderer/lib/ipc'
import { useAsync } from '@renderer/lib/useAsync'
import { cn } from '@renderer/lib/utils'
import { schemaCache } from '../editor/schemaCache'

function SchemaNode({ schema, filter, defaultOpen, reloadKey }: { schema: string; filter: string; defaultOpen: boolean; reloadKey: number }) {
  const [open, setOpen] = useState(defaultOpen)
  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open && !filter) return
    setTables(null)
    schemaCache
      .listTables(schema)
      .then(setTables)
      .catch((e: unknown) => setError(asAppError(e).message))
  }, [open, filter, schema, reloadKey])

  const visible = useMemo(() => (tables ?? []).filter((t) => !filter || t.name.toLowerCase().includes(filter)), [tables, filter])
  if (filter && tables && visible.length === 0) return null
  const expanded = open || !!filter

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/schema flex h-6 w-full items-center rounded hover:bg-accent/60 data-[state=open]:bg-accent">
            <button className="flex h-6 min-w-0 flex-1 items-center gap-1 px-1 text-left" onClick={() => setOpen(!open)}>
              <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <Layers className="size-3 shrink-0 text-sky-400/80" />
              <span className="truncate">{schema}</span>
            </button>
            <button className="hidden shrink-0 px-1 text-muted-foreground hover:text-foreground group-hover/schema:block" onClick={() => actions.openDiagram(schema)} title={`Open the ${schema} diagram`} aria-label={`Open ${schema} diagram`}>
              <Network className="size-3" />
            </button>
            {tables && <span className="shrink-0 pr-1 text-[10px] text-muted-foreground group-hover/schema:hidden">{tables.length}</span>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{schema}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => actions.openDiagram(schema)}>
            <Network /> Open diagram
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(schema, 'Copied schema name')}>
            <Copy /> Copy schema name
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded && (
        <div className="ml-3 border-l border-border/60 pl-1">
          {!tables && !error && <Spinner className="m-1" />}
          {error && <p className="px-2 text-[11px] text-red-400">{error}</p>}
          {visible.map((t) => {
            const qualified = `${quoteIfNeeded(schema)}.${quoteIfNeeded(t.name)}`
            return (
              <ContextMenu key={t.name}>
                <ContextMenuTrigger asChild>
                  <button
                    className="flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-accent/60 data-[state=open]:bg-accent"
                    onClick={() => actions.openTable(schema, t.name)}
                    title={`${schema}.${t.name} (${t.kind}). Drag into the editor to insert.`}
                    draggable
                    // Monaco accepts text/plain drops at the drop position.
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', qualified)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    {t.kind === 'table' ? <Table2 className="size-3 shrink-0 text-muted-foreground" /> : <Eye className="size-3 shrink-0 text-violet-400/80" />}
                    <span className="truncate">{t.name}</span>
                    {(() => {
                      const est = schemaCache.index?.resolve(schema, t.name)?.rowEstimate
                      return est != null && <span className="ml-auto shrink-0 pl-1 text-[10px] tabular-nums text-muted-foreground/70">{compactCount(est)}</span>
                    })()}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>
                    {schema}.{t.name} · {t.kind}
                  </ContextMenuLabel>
                  <ContextMenuItem onSelect={() => actions.openTable(schema, t.name)}>
                    <Table2 /> Open
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.newQueryTab(`SELECT *\nFROM ${qualified}\nLIMIT 100;`)}>
                    <Code2 /> SELECT … LIMIT 100 in new tab
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.newQueryTab(`SELECT count(*)\nFROM ${qualified};`)}>Count rows in new tab</ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.openTable(schema, t.name, { info: true })}>
                    <Info /> Show info &amp; DDL
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.openDiagram(schema, t.name)}>
                    <Network /> Show in diagram
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => void copyText(t.name, 'Copied table name')}>
                    <ClipboardCopy /> Copy name
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => void copyText(qualified, 'Copied qualified name')}>Copy qualified name</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => actions.newQueryTab(`-- Review before running. Runs through the destructive-SQL guard.\nTRUNCATE TABLE ${qualified};`)}>
                    Generate TRUNCATE…
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.newQueryTab(`-- Review before running. Runs through the destructive-SQL guard.\nDROP ${t.kind === 'view' ? 'VIEW' : t.kind === 'materialized-view' ? 'MATERIALIZED VIEW' : 'TABLE'} ${qualified};`)}>
                    Generate DROP…
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
          <SchemaObjectsGroups schema={schema} filter={filter} />
        </div>
      )}
    </div>
  )
}

export function SchemaExplorer({ sessionId }: { sessionId: string }) {
  const [filter, setFilter] = useState('')
  const [localKey, setReloadKey] = useState(0)
  const schemaVersion = useAppState((s) => s.schemaVersion)
  const reloadKey = localKey + schemaVersion * 1000
  const schemas = useAsync(() => schemaCache.listSchemas(), [sessionId, reloadKey])
  const f = filter.trim().toLowerCase()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input className="pl-7" placeholder="Filter tables…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Refresh schema"
          onClick={() => {
            schemaCache.invalidate()
            setReloadKey((k) => k + 1)
          }}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2 text-[12px]">
        {schemas.loading && <Spinner className="m-2" />}
        {schemas.error && <ErrorBanner className="m-1" error={schemas.error} />}
        {schemas.data?.map((s, i) => (
          <SchemaNode key={`${s.name}-${reloadKey}`} schema={s.name} filter={f} defaultOpen={s.name === 'public' || i === 0} reloadKey={reloadKey} />
        ))}
      </div>
    </div>
  )
}
