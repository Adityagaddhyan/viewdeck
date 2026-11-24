/**
 * Side panel in a query tab: Recent (this connection's history) and Starred
 * (saved queries, connection-scoped or global). Click opens a query in the
 * editor (replacing its text). Hover or right-click offers new tab, copy,
 * star / rename / delete. Both lists are searchable.
 */
import { useEffect, useMemo, useState } from 'react'
import { Clock, Copy, ExternalLink, Pencil, Search, Star, Trash2 } from 'lucide-react'
import type { QueryHistoryEntry, SavedQuery } from '@shared/types/connection'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { Input, Spinner } from '@renderer/components/ui/primitives'
import { call } from '@renderer/lib/ipc'
import { copyText } from '@renderer/lib/clipboard'
import { actions } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function QueriesPanel({
  connectionId,
  version,
  onOpen,
  onStar
}: {
  connectionId: string | null
  /** Bump to reload (after a run or a star). */
  version: number
  onOpen: (sql: string) => void
  onStar: (sql: string) => void
}) {
  const [tab, setTab] = useState<'recent' | 'starred'>('recent')
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<QueryHistoryEntry[] | null>(null)
  const [starred, setStarred] = useState<SavedQuery[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    void call('history:list', { connectionId, limit: 300 }).then(setRecent).catch(() => setRecent([]))
    void call('queries:list', { connectionId }).then(setStarred).catch(() => setStarred([]))
  }, [connectionId, version, reloadKey])

  const q = query.trim().toLowerCase()
  const recentShown = useMemo(() => {
    const seen = new Set<string>()
    return (recent ?? []).filter((h) => {
      const key = h.sql.trim()
      if (seen.has(key)) return false // dedupe consecutive re-runs
      seen.add(key)
      return !q || h.sql.toLowerCase().includes(q)
    })
  }, [recent, q])
  const starredShown = useMemo(() => (starred ?? []).filter((s) => !q || `${s.name} ${s.sql}`.toLowerCase().includes(q)), [starred, q])

  const rename = async (s: SavedQuery, name: string): Promise<void> => {
    setRenaming(null)
    if (name.trim() && name !== s.name) await call('queries:save', { id: s.id, connectionId: s.connectionId, name: name.trim(), sql: s.sql })
    setReloadKey((k) => k + 1)
  }
  const remove = async (s: SavedQuery): Promise<void> => {
    await call('queries:delete', { id: s.id })
    actions.showToast(`Removed “${s.name}”`)
    setReloadKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l bg-card/40">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 pt-1.5">
        {(['recent', 'starred'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('-mb-px flex items-center gap-1 border-b-2 px-2 pb-1.5 text-xs', tab === t ? 'border-sky-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t === 'recent' ? <Clock className="size-3" /> : <Star className="size-3" />}
            {t === 'recent' ? 'Recent' : 'Starred'}
            <span className="text-[10px] text-muted-foreground">{t === 'recent' ? recentShown.length : starredShown.length}</span>
          </button>
        ))}
      </div>
      <div className="relative shrink-0 p-2">
        <Search className="absolute left-4 top-3.5 size-3.5 text-muted-foreground" />
        <Input className="pl-7" placeholder="Search queries…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {(tab === 'recent' ? recent : starred) === null && <Spinner className="m-2" />}
        {tab === 'recent' && recent && recentShown.length === 0 && <p className="p-3 text-xs text-muted-foreground">No queries yet. Runs appear here.</p>}
        {tab === 'starred' && starred && starredShown.length === 0 && <p className="p-3 text-xs text-muted-foreground">Star a query with ☆ in the toolbar to keep it here.</p>}

        {tab === 'recent' &&
          recentShown.map((h) => (
            <Item key={h.id} sql={h.sql} onOpen={onOpen} onStar={onStar}>
              <span className={h.error ? 'text-red-400' : undefined}>
                {timeAgo(h.executedAt)}
                {h.error ? ' · error' : `${h.durationMs !== null ? ` · ${h.durationMs} ms` : ''}${h.rowCount !== null ? ` · ${h.rowCount.toLocaleString()} rows` : ''}`}
              </span>
            </Item>
          ))}

        {tab === 'starred' &&
          starredShown.map((s) => (
            <Item
              key={s.id}
              sql={s.sql}
              onOpen={onOpen}
              title={
                renaming === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.name}
                    className="w-full rounded border bg-background px-1 text-xs outline-none select-text"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(s, e.currentTarget.value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={(e) => void rename(s, e.currentTarget.value)}
                  />
                ) : (
                  <span className="flex items-center gap-1 font-sans text-xs font-medium">
                    <Star className="size-3 fill-amber-400 text-amber-400" /> {s.name}
                    {s.connectionId === null && <span className="text-[10px] font-normal text-muted-foreground">· all connections</span>}
                  </span>
                )
              }
              extraMenu={
                <>
                  <ContextMenuItem onSelect={() => setRenaming(s.id)}>
                    <Pencil /> Rename
                  </ContextMenuItem>
                  <ContextMenuItem destructive onSelect={() => void remove(s)}>
                    <Trash2 /> Remove from starred
                  </ContextMenuItem>
                </>
              }
            />
          ))}
      </div>
    </div>
  )
}

function Item({
  sql,
  title,
  children,
  onOpen,
  onStar,
  extraMenu
}: {
  sql: string
  title?: React.ReactNode
  children?: React.ReactNode
  onOpen: (sql: string) => void
  onStar?: (sql: string) => void
  extraMenu?: React.ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(sql)}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(sql)}
          className="group relative cursor-pointer space-y-0.5 rounded px-2 py-1.5 hover:bg-accent/60 data-[state=open]:bg-accent/60"
          title="Click to open in this editor"
        >
          {title}
          <pre className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground/90">{sql.trim()}</pre>
          {children && <div className="text-[10px] text-muted-foreground">{children}</div>}
          <div className="absolute right-1 top-1 hidden gap-0.5 rounded bg-popover/90 p-0.5 group-hover:flex">
            <IconBtn label="Open in new tab" onClick={() => actions.newQueryTab(sql)}>
              <ExternalLink />
            </IconBtn>
            <IconBtn label="Copy SQL" onClick={() => void copyText(sql, 'Copied query')}>
              <Copy />
            </IconBtn>
            {onStar && (
              <IconBtn label="Star" onClick={() => onStar(sql)}>
                <Star />
              </IconBtn>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(sql)}>Open in this editor</ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.newQueryTab(sql)}>
          <ExternalLink /> Open in new tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(sql, 'Copied query')}>
          <Copy /> Copy SQL
        </ContextMenuItem>
        {onStar && (
          <ContextMenuItem onSelect={() => onStar(sql)}>
            <Star /> Star…
          </ContextMenuItem>
        )}
        {extraMenu && <ContextMenuSeparator />}
        {extraMenu}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}
