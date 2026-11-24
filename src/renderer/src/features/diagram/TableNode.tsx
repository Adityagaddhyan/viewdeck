/**
 * Table card for the ER diagram (React Flow custom node).
 * Semantic zoom: below ~45% zoom only the name shows (big), so a 300-table overview
 * stays readable; closer in, the key columns (PK 🔑 / relationship 🔗) appear.
 * Visual state (focus / neighbour / on path / dimmed) comes from `data.state`.
 */
import { memo } from 'react'
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react'
import { Eye, ExternalLink, KeyRound, Link2, Table2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { CARD_WIDTH, MAX_CARD_ROWS, ROW_H, HEADER_H } from './diagramLayout'
import type { DiagramNode } from './graphModel'

export type NodeState = 'normal' | 'focus' | 'neighbor' | 'path' | 'dim'

export interface TableNodeData extends Record<string, unknown> {
  node: DiagramNode
  /** Columns that take part in a relationship (for the 🔗 icon). */
  linkCols: Set<string>
  color: string
  state: NodeState
}

const compactSelector = (s: { transform: [number, number, number] }): boolean => s.transform[2] < 0.45

function fmtRows(n: number | null): string {
  if (n === null) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export const TableNode = memo(function TableNode({ data }: NodeProps & { data: TableNodeData }) {
  const compact = useStore(compactSelector)
  const { node, linkCols, color, state } = data
  const typeOf = new Map(node.columns.map((c) => [c.name, c.dataType]))
  const shown = node.keyColumns.slice(0, MAX_CARD_ROWS)
  const more = node.keyColumns.length - shown.length
  const Icon = node.external ? ExternalLink : node.kind === 'view' || node.kind === 'materialized_view' ? Eye : Table2
  return (
    <div
      className={cn(
        'rounded-md border bg-card text-card-foreground shadow-sm transition-opacity',
        node.external && 'border-dashed bg-card/60',
        state === 'focus' && 'ring-2 ring-sky-500',
        state === 'path' && 'ring-2 ring-amber-500',
        state === 'neighbor' && 'ring-1 ring-sky-400/60',
        state === 'dim' && 'opacity-15'
      )}
      style={{ width: CARD_WIDTH, borderTop: `3px solid ${color}` }}
      data-table={node.id}
    >
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
      <div className="flex items-center gap-1.5 px-2" style={{ height: HEADER_H }}>
        <Icon className={cn('shrink-0 text-muted-foreground', compact ? 'size-5' : 'size-3.5')} />
        <span className={cn('truncate font-semibold', compact ? 'text-[20px]' : 'text-[12px]')} title={node.id}>
          {node.external ? `${node.schema}.${node.name}` : node.name}
        </span>
        {!compact && node.rowEstimate !== null && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{fmtRows(node.rowEstimate)}</span>}
      </div>
      {!compact && (
        <div className="pb-1.5 font-mono text-[10.5px]">
          {shown.map((col) => {
            const pk = node.primaryKey.includes(col)
            return (
              <div key={col} className="flex items-center gap-1 px-2" style={{ height: ROW_H }}>
                {pk ? <KeyRound className="size-3 shrink-0 text-amber-500" /> : linkCols.has(col) ? <Link2 className="size-3 shrink-0 text-sky-500" /> : <span className="w-3" />}
                <span className={cn('truncate', pk && 'font-semibold')}>{col}</span>
                <span className="ml-auto truncate pl-2 text-muted-foreground">{typeOf.get(col) ?? ''}</span>
              </div>
            )
          })}
          {more > 0 && <div className="px-2 text-muted-foreground" style={{ height: ROW_H }}>+{more} more</div>}
        </div>
      )}
    </div>
  )
})

const zoomSelector = (s: { transform: [number, number, number] }): number => s.transform[2]

/**
 * Translucent box behind a cluster of related tables, labelled with its hub table.
 * The label grows as you zoom out (constant on-screen size), so the overview reads like a
 * map of named areas even when the cards themselves are too small to read.
 */
export const ClusterNode = memo(function ClusterNode({ data }: NodeProps & { data: { label: string; color: string; size: number; dim: boolean } }) {
  const zoom = useStore(zoomSelector)
  const fontSize = Math.min(13 / Math.max(zoom, 0.05), 90)
  const mapView = zoom < 0.55
  return (
    <div className={cn('relative h-full w-full rounded-xl border transition-opacity', data.dim && 'opacity-30')} style={{ borderColor: data.color, borderWidth: mapView ? 2 / zoom : 1, background: `color-mix(in oklab, ${data.color} ${mapView ? 12 : 6}%, transparent)` }}>
      <div
        className={cn('pointer-events-none whitespace-nowrap px-3 pt-2 font-semibold', mapView && 'absolute bottom-full left-0 rounded-t-lg')}
        style={{ color: data.color, fontSize, lineHeight: 1.2, ...(mapView ? { background: 'color-mix(in oklab, var(--background) 85%, transparent)', padding: `${fontSize * 0.2}px ${fontSize * 0.45}px`, marginBottom: 2 / zoom } : {}) }}
      >
        {data.label} <span className="font-normal opacity-70">· {data.size}</span>
      </div>
    </div>
  )
})
