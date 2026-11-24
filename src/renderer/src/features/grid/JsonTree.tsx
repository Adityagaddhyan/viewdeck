/**
 * Collapsible JSON tree for the value viewer. Each container toggles open and
 * closed, and the parent controls expand/collapse all via `expanded` (a set of
 * JSON-encoded paths). Right-click a node to copy its value, its JSONPath, or
 * a Postgres accessor expression.
 */
import { ChevronRight } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { copyText } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { jsonPath, pgAccessor, type JsonKey } from './jsonPath'

interface Props {
  value: unknown
  column: string
  expanded: Set<string>
  onToggle: (pathKey: string) => void
}

function Scalar({ v }: { v: unknown }) {
  if (v === null) return <span className="italic text-muted-foreground">null</span>
  if (typeof v === 'string') return <span className="break-all text-amber-700 dark:text-amber-200">"{v}"</span>
  if (typeof v === 'number') return <span className="text-violet-300">{v}</span>
  if (typeof v === 'boolean') return <span className="text-sky-600 dark:text-sky-300">{String(v)}</span>
  return <span>{String(v)}</span>
}

function Node({ k, v, path, ...p }: Props & { k: JsonKey | null; v: unknown; path: JsonKey[] }) {
  const key = JSON.stringify(path)
  const isObj = v !== null && typeof v === 'object'
  const entries: Array<[JsonKey, unknown]> = isObj ? (Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as object)) : []
  const open = p.expanded.has(key)
  const label =
    k === null ? null : typeof k === 'number' ? <span className="text-muted-foreground">{k}</span> : <span className="text-sky-700 dark:text-sky-200">{k}</span>

  const row = (
    <div
      className={cn('flex items-start gap-1 rounded px-1 py-px hover:bg-accent/50', isObj && 'cursor-pointer')}
      onClick={() => isObj && p.onToggle(key)}
    >
      <ChevronRight className={cn('mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform', !isObj && 'invisible', open && 'rotate-90')} />
      {label && <span className="shrink-0">{label}:</span>}
      {isObj ? (
        <span className="text-muted-foreground">
          {Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}
          {!open && <span className="ml-1 opacity-60">{Array.isArray(v) ? 'array' : 'object'}</span>}
        </span>
      ) : (
        <Scalar v={v} />
      )}
    </div>
  )

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{jsonPath(path)}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => void copyText(typeof v === 'string' ? v : JSON.stringify(v, null, 2), 'Copied value')}>Copy value</ContextMenuItem>
          {isObj && <ContextMenuItem onSelect={() => void copyText(JSON.stringify(v), 'Copied minified JSON')}>Copy minified</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void copyText(jsonPath(path), 'Copied JSONPath')}>Copy JSONPath</ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(pgAccessor(p.column, path), 'Copied Postgres accessor')}>Copy Postgres accessor</ContextMenuItem>
          {k !== null && <ContextMenuItem onSelect={() => void copyText(String(k), 'Copied key')}>Copy key</ContextMenuItem>}
        </ContextMenuContent>
      </ContextMenu>
      {isObj && open && (
        <div className="ml-3 border-l border-border/60 pl-1.5">
          {entries.map(([ck, cv]) => (
            <Node key={String(ck)} k={ck} v={cv} path={[...path, ck]} {...p} />
          ))}
        </div>
      )}
    </div>
  )
}

export function JsonTree(props: Props) {
  return (
    <div className="font-mono text-[12px] leading-5 select-text">
      <Node k={null} v={props.value} path={[]} {...props} />
    </div>
  )
}
