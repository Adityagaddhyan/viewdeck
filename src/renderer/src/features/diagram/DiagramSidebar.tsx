/**
 * Right-hand panel of the diagram: find a table, "How are these related?" (shortest join
 * path + ready-to-run SQL), the focused table's relationships, clusters, hub tables and
 * unconnected tables, plus the inferred-relationships toggle and freshness.
 */
import { useMemo, useState } from 'react'
import { ArrowRight, Copy, GitFork, Play, RefreshCw, Search, Waypoints } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { copyText } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { fuzzyFilter } from '../palette/fuzzy'
import type { DiagramEdge, DiagramModel, NodeId } from './graphModel'

export function TableSearch({ model, placeholder, onPick, inputRef, value }: { model: DiagramModel; placeholder: string; onPick: (id: NodeId) => void; inputRef?: React.Ref<HTMLInputElement>; value?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const results = useMemo(() => (q.trim() ? fuzzyFilter(model.nodes, q.trim(), (n) => n.name, 12) : []), [q, model])
  const pick = (id: NodeId): void => {
    onPick(id)
    setQ('')
    setOpen(false)
  }
  return (
    <div className="relative">
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/70"
          placeholder={value || placeholder}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setSel(0))}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, results.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
            else if (e.key === 'Enter' && results[sel]) pick(results[sel].item.id)
            else if (e.key === 'Escape') (setQ(''), setOpen(false))
          }}
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute inset-x-0 top-8 z-30 max-h-64 overflow-auto rounded-md border bg-popover py-1 text-[12px] shadow-lg">
          {results.map((r, i) => (
            <button key={r.item.id} onMouseDown={() => pick(r.item.id)} className={cn('flex w-full items-center gap-2 px-2 py-1 text-left', i === sel && 'bg-accent')}>
              <span className="truncate">{r.item.external ? `${r.item.schema}.${r.item.name}` : r.item.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{r.item.inDegree + r.item.outDegree} links</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-b px-3 py-2">
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
    {children}
  </div>
)

export interface SidebarProps {
  model: DiagramModel
  focusId: NodeId | null
  onFocus: (id: NodeId) => void
  onFitCluster: (id: number) => void
  clusterColor: (id: number) => string
  inferred: boolean
  setInferred: (v: boolean) => void
  path: { from: NodeId | null; to: NodeId | null; edges: DiagramEdge[] | null; sql: string }
  setPathEnd: (end: 'from' | 'to', id: NodeId | null) => void
  onRunSql: (sql: string) => void
  fetchedAt: string | null
  refreshing: boolean
  onRefresh: () => void
  searchRef: React.Ref<HTMLInputElement>
}

export function DiagramSidebar(p: SidebarProps) {
  const { model } = p
  const name = (id: NodeId | null): string => (id ? (model.byId.get(id)?.name ?? id) : '')
  const fks = model.edges.filter((e) => e.kind === 'fk').length
  const inferredCount = model.edges.length - fks
  const focusEdges = p.focusId ? model.edges.filter((e) => e.from === p.focusId || e.to === p.focusId) : []
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-card/40 text-[12px]">
      <Section title="Find a table">
        <TableSearch model={model} placeholder="Search tables (⌘F)" onPick={p.onFocus} inputRef={p.searchRef} />
        <div className="mt-2 text-[11px] text-muted-foreground">
          {model.nodes.filter((n) => !n.external).length} tables · {fks} foreign keys{p.inferred ? ` · ${inferredCount} inferred` : ''} · {model.clusters.length} clusters
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px]">
          <input type="checkbox" checked={p.inferred} onChange={(e) => p.setInferred(e.target.checked)} />
          Show inferred relationships <span className="text-muted-foreground">(dashed)</span>
        </label>
        <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
          {p.fetchedAt && <span>Read {new Date(p.fetchedAt).toLocaleString()}</span>}
          <button className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={p.onRefresh} disabled={p.refreshing} title="Re-read the schema">
            <RefreshCw className={cn('size-3', p.refreshing && 'animate-spin')} /> Refresh
          </button>
        </div>
      </Section>

      <Section title="How are these related?">
        <div className="space-y-1.5">
          <TableSearch model={model} placeholder="From table…" value={name(p.path.from)} onPick={(id) => p.setPathEnd('from', id)} />
          <TableSearch model={model} placeholder="To table…" value={name(p.path.to)} onPick={(id) => p.setPathEnd('to', id)} />
        </div>
        {p.path.from && p.path.to && (
          <div className="mt-2">
            {p.path.edges === null ? (
              <div className="text-muted-foreground">No connection between these tables.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1 text-[11.5px]">
                  <Waypoints className="size-3.5 text-amber-500" />
                  {p.path.edges.length} join{p.path.edges.length === 1 ? '' : 's'}
                  {p.path.edges.some((e) => e.kind === 'inferred') && <span className="text-amber-700 dark:text-amber-400">(uses inferred links)</span>}
                </div>
                <pre className="mt-1 max-h-40 overflow-auto rounded border bg-background p-1.5 font-mono text-[10.5px]">{p.path.sql}</pre>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6" onClick={() => void copyText(p.path.sql, 'Copied join SQL')}>
                    <Copy /> Copy
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6" onClick={() => p.onRunSql(p.path.sql)}>
                    <Play /> Open in query tab
                  </Button>
                </div>
              </>
            )}
            <button className="mt-1 text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => (p.setPathEnd('from', null), p.setPathEnd('to', null))}>
              Clear
            </button>
          </div>
        )}
      </Section>

      {p.focusId && (
        <Section title={`Relationships of ${name(p.focusId)}`}>
          {focusEdges.length === 0 && <div className="text-muted-foreground">None.</div>}
          {focusEdges.map((e) => {
            const other = e.from === p.focusId ? e.to : e.from
            return (
              <button key={e.id} onClick={() => p.onFocus(other)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-accent">
                <ArrowRight className={cn('size-3 shrink-0', e.from === p.focusId ? 'text-sky-500' : 'rotate-180 text-emerald-500')} />
                <span className="truncate">{name(other)}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {(e.from === p.focusId ? e.fromColumns : e.toColumns).join(', ')}
                  {e.kind === 'inferred' ? ' ?' : ''}
                </span>
              </button>
            )
          })}
        </Section>
      )}

      <Section title="Clusters">
        {model.clusters.map((c) => (
          <button key={c.id} onClick={() => p.onFitCluster(c.id)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.clusterColor(c.id) }} />
            <span className="truncate">{c.label}</span>
            <span className="ml-auto text-[10.5px] text-muted-foreground">{c.size}</span>
          </button>
        ))}
      </Section>

      {model.hubs.length > 0 && (
        <Section title="Hub tables (most connected)">
          {model.hubs.map((id) => {
            const n = model.byId.get(id)
            return (
              <button key={id} onClick={() => p.onFocus(id)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent">
                <GitFork className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{n?.name}</span>
                <span className="ml-auto text-[10.5px] text-muted-foreground">{(n?.inDegree ?? 0) + (n?.outDegree ?? 0)}</span>
              </button>
            )
          })}
        </Section>
      )}

      {model.isolated.length > 0 && (
        <Section title={`Unconnected tables (${model.isolated.length})`}>
          <div className="flex flex-wrap gap-1">
            {model.isolated.slice(0, 60).map((id) => (
              <button key={id} onClick={() => p.onFocus(id)} className="rounded border px-1.5 py-0.5 text-[10.5px] hover:bg-accent">
                {model.byId.get(id)?.name}
              </button>
            ))}
          </div>
        </Section>
      )}
    </aside>
  )
}
