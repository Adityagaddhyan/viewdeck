/** Cmd/Ctrl+K command palette: fuzzy-jump to tables, schemas, recent queries, connections and actions. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Code2, Layers, Plug, Search, Star, Table2, Zap } from 'lucide-react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Spinner } from '@renderer/components/ui/primitives'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { actions, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { fuzzyFilter, type FuzzyResult } from './fuzzy'
import { buildPaletteItems, type PaletteGroup, type PaletteItem } from './paletteItems'

const ICONS: Record<PaletteGroup, typeof Zap> = {
  Actions: Zap,
  Tables: Table2,
  Schemas: Layers,
  Starred: Star,
  'Recent queries': Code2,
  Connections: Plug
}
/** Group order when the query is empty. When searching, results are ranked by score. */
const ORDER: PaletteGroup[] = ['Actions', 'Starred', 'Tables', 'Recent queries', 'Schemas', 'Connections']

function Highlight({ text, match }: { text: string; match: FuzzyResult }) {
  if (match.positions.length === 0) return <>{text}</>
  const set = new Set(match.positions)
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className={set.has(i) ? 'font-semibold text-sky-600 dark:text-sky-300' : undefined}>
          {ch}
        </span>
      ))}
    </>
  )
}

export function CommandPalette() {
  const open = useAppState((s) => s.paletteOpen)
  const [items, setItems] = useState<PaletteItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setItems(null)
    void buildPaletteItems(MOD_LABEL).then(setItems)
  }, [open])

  const results = useMemo(() => {
    const ranked = fuzzyFilter(items ?? [], query, (i) => i.searchText ?? i.label, 80)
    if (query.trim()) return ranked
    return ranked.sort((a, b) => ORDER.indexOf(a.item.group) - ORDER.indexOf(b.item.group)).slice(0, 60)
  }, [items, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  async function choose(item: PaletteItem): Promise<void> {
    const next = item.run()
    if (typeof next === 'string') {
      setQuery(next)
      return
    }
    actions.setPalette(false)
    await next
  }

  return (
    <Dialog open={open} onOpenChange={actions.setPalette}>
      <DialogContent
        title="Command palette"
        description="Jump to a table, recent query or connection"
        hideHeader
        className="top-[14%] max-w-xl translate-y-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 select-text"
            placeholder="Jump to a table, query, connection or action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(i + 1, results.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)))
              if (e.key === 'Enter' && results[index]) (e.preventDefault(), void choose(results[index].item))
            }}
          />
          {!items && <Spinner />}
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-auto p-1">
          {items && results.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No matches</p>}
          {results.map(({ item, match }, i) => {
            const Icon = ICONS[item.group]
            const showGroup = !query.trim() && (i === 0 || results[i - 1]?.item.group !== item.group)
            return (
              <div key={item.id}>
                {showGroup && <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.group}</div>}
                <button
                  data-idx={i}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs', i === index ? 'bg-accent text-foreground' : 'text-foreground/90')}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => void choose(item)}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className={cn('truncate', item.group === 'Recent queries' && 'font-mono text-[11px]')}>
                    <Highlight text={item.label} match={item.searchText ? { score: 0, positions: [] } : match} />
                  </span>
                  {item.detail && <span className="ml-auto shrink-0 truncate pl-2 text-[10px] text-muted-foreground">{item.detail}</span>}
                  {item.shortcut && <kbd className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">{item.shortcut}</kbd>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>{MOD_LABEL}K toggle</span>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
