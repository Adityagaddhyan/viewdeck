/**
 * Hover cards for the diagram: a table (all columns with types, keys, comment, size,
 * relationship counts) or a relationship (exact columns, cardinality in words, delete
 * rule, constraint name, or why it was inferred). Follows the mouse, clamped on screen.
 */
import { KeyRound, Link2 } from 'lucide-react'
import type { DiagramEdge, DiagramModel, DiagramNode } from './graphModel'

export type Hovered = { kind: 'node'; id: string; x: number; y: number } | { kind: 'edge'; id: string; x: number; y: number }

const fmtBytes = (b: number | null): string => {
  if (b === null) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

function NodeCard({ n, model }: { n: DiagramNode; model: DiagramModel }) {
  const fkCols = new Set(model.edges.filter((e) => e.from === n.id).flatMap((e) => e.fromColumns))
  const cols = n.columns.slice(0, 40)
  return (
    <>
      <div className="font-semibold">{n.schema}.{n.name}</div>
      <div className="mb-1 text-muted-foreground">
        {n.kind.replace('_', ' ')}
        {n.rowEstimate !== null && ` · ~${n.rowEstimate.toLocaleString()} rows`}
        {n.totalBytes !== null && ` · ${fmtBytes(n.totalBytes)}`}
        {` · ${n.outDegree} out, ${n.inDegree} in`}
      </div>
      {n.comment && <div className="mb-1 italic text-muted-foreground">{n.comment}</div>}
      <div className="font-mono text-[10.5px]">
        {cols.map((c) => (
          <div key={c.name} className="flex items-center gap-1">
            {n.primaryKey.includes(c.name) ? <KeyRound className="size-3 text-amber-500" /> : fkCols.has(c.name) ? <Link2 className="size-3 text-sky-500" /> : <span className="w-3" />}
            <span>{c.name}</span>
            <span className="ml-auto pl-3 text-muted-foreground">{c.dataType}{c.nullable ? '' : ' not null'}</span>
          </div>
        ))}
        {n.columns.length > cols.length && <div className="text-muted-foreground">+{n.columns.length - cols.length} more</div>}
        {n.external && <div className="mt-1 text-muted-foreground">(other schema: only key columns shown)</div>}
      </div>
      <div className="mt-1 text-muted-foreground">Click to focus · double-click to open</div>
    </>
  )
}

function EdgeCard({ e, model }: { e: DiagramEdge; model: DiagramModel }) {
  const child = model.byId.get(e.from)
  const parent = model.byId.get(e.to)
  const pairs = e.fromColumns.map((c, i) => `${child?.name}.${c} → ${parent?.name}.${e.toColumns[i] ?? '?'}`)
  const meaning =
    e.cardinality === 'one-to-one'
      ? `Each ${parent?.name} has at most one ${child?.name}.`
      : `Each ${parent?.name} can have many ${child?.name} rows.`
  const parentSide = e.required ? `Every ${child?.name} row must have a ${parent?.name}.` : `A ${child?.name} row may have no ${parent?.name} (nullable).`
  return (
    <>
      <div className="font-semibold">
        {e.kind === 'inferred' ? 'Inferred relationship' : 'Foreign key'} · {e.cardinality === 'one-to-one' ? 'one-to-one' : 'many-to-one'}
        {e.selfReference && ' · self-reference'}
      </div>
      <div className="font-mono text-[10.5px]">
        {pairs.map((p) => (
          <div key={p}>{p}</div>
        ))}
      </div>
      <div className="mt-1">{meaning}</div>
      <div>{parentSide}</div>
      {e.kind === 'fk' ? (
        <div className="mt-1 text-muted-foreground">
          {e.constraintName} · on delete {e.onDelete?.toLowerCase()} · on update {e.onUpdate?.toLowerCase()}
          {e.composite && ' · composite key'}
        </div>
      ) : (
        <div className="mt-1 text-amber-700 dark:text-amber-400">
          Not declared in the database ({e.confidence} confidence): {e.reason}
        </div>
      )}
    </>
  )
}

export function DiagramHover({ hovered, model, bounds }: { hovered: Hovered; model: DiagramModel; bounds: DOMRect | null }) {
  const n = hovered.kind === 'node' ? model.byId.get(hovered.id) : undefined
  const e = hovered.kind === 'edge' ? model.edges.find((x) => x.id === hovered.id) : undefined
  if (!n && !e) return null
  const w = 320
  const left = Math.min(hovered.x + 16, (bounds?.width ?? 1e4) - w - 8)
  const top = Math.min(hovered.y + 16, (bounds?.height ?? 1e4) - 160)
  return (
    <div className="pointer-events-none absolute z-30 max-h-[60%] overflow-hidden rounded-md border bg-popover p-2 text-[11.5px] text-popover-foreground shadow-xl" style={{ left, top, width: w }}>
      {n ? <NodeCard n={n} model={model} /> : e ? <EdgeCard e={e} model={model} /> : null}
    </div>
  )
}
