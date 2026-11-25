/**
 * Side panel for inspecting one cell. JSON (json/jsonb columns, or text that is
 * a JSON object/array) opens as a collapsible tree with expand/collapse all and
 * a pretty "Raw" view. Other values show wrapped. When `onSave` is provided
 * (session unlocked, row editable), the value can be edited, and the edit is
 * STAGED like any grid edit (ADR-003), never written directly. ⌘F finds text in the
 * value: in the tree it expands to and highlights matching keys and values.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Copy, Pencil } from 'lucide-react'
import type { CellValue } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { Dialog, SheetContent } from '@renderer/components/ui/dialog'
import { Badge } from '@renderer/components/ui/primitives'
import { copyText } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { parseJsonCell } from './copyFormats'
import { containerPaths } from './jsonPath'
import { JsonTree } from './JsonTree'
import { Highlight, ValueFindBar } from './ValueFindBar'
import { ancestorKeys, jsonMatches, textMatches } from './valueSearch'

export interface ViewerTarget {
  column: string
  dataType: string
  value: CellValue
  /** Present when the cell may be edited. Receives the new value to stage. */
  onSave?: (v: CellValue) => void
}

export function ValueViewer({ target, onClose }: { target: ViewerTarget | null; onClose: () => void }) {
  const parsed = useMemo(() => (target ? parseJsonCell(target.value, target.dataType) : { ok: false as const }), [target])
  const [mode, setMode] = useState<'tree' | 'raw' | 'edit'>('tree')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const findRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!target) return
    setMode(parsed.ok ? 'tree' : 'raw')
    setExpanded(new Set(parsed.ok ? containerPaths(parsed.value, 2) : []))
    setDraftError(null)
    setQuery('')
  }, [target, parsed])

  const pretty = !target ? '' : parsed.ok ? JSON.stringify(parsed.value, null, 2) : target.value === null ? '' : String(target.value)
  const treeHits = useMemo(() => (parsed.ok ? jsonMatches(parsed.value, query) : []), [parsed, query])
  const rawHits = useMemo(() => textMatches(pretty, query), [pretty, query])
  const total = mode === 'tree' ? treeHits.length : mode === 'raw' ? rawHits.length : 0
  const current = total === 0 ? 0 : Math.min(hit, total - 1)

  // New query: start at the first match and open every container above a tree match.
  useEffect(() => {
    setHit(0)
    if (treeHits.length > 0) setExpanded((s) => new Set([...s, ...ancestorKeys(treeHits)]))
  }, [treeHits])

  useEffect(() => {
    const el = bodyRef.current?.querySelector('[data-current-match]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current, query, mode, expanded])

  if (!target) return null
  const isJson = parsed.ok
  const step = (d: 1 | -1): void => {
    if (total > 0) setHit((current + d + total) % total)
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f' && mode !== 'edit') {
      // Keep the grid's / query tab's ⌘F (window listeners) from also firing.
      e.preventDefault()
      e.stopPropagation()
      findRef.current?.focus()
      findRef.current?.select()
    }
  }

  const startEdit = (): void => {
    setDraft(pretty)
    setDraftError(null)
    setMode('edit')
  }
  const save = (): void => {
    let v: string = draft
    if (/^jsonb?$/i.test(target.dataType)) {
      try {
        v = JSON.stringify(JSON.parse(draft)) // validate + normalise
      } catch (e) {
        setDraftError(`Invalid JSON: ${(e as Error).message}`)
        return
      }
    }
    target.onSave?.(v)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        onKeyDown={onKeyDown}
        onEscapeKeyDown={(e) => {
          if (query !== '') {
            e.preventDefault() // first Esc clears the find, the next one closes
            setQuery('')
          }
        }}
        title={target.column} description={`${target.dataType}${target.value === null ? ' · NULL' : ` · ${pretty.length.toLocaleString()} chars`}`}>
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
          {isJson && (
            <>
              <Tab active={mode === 'tree'} onClick={() => setMode('tree')}>Tree</Tab>
              <Tab active={mode === 'raw'} onClick={() => setMode('raw')}>Raw</Tab>
            </>
          )}
          {mode === 'edit' && <Badge tone="amber">editing: staged on save</Badge>}
          <div className="ml-auto flex items-center gap-1">
            {isJson && mode === 'tree' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(containerPaths(parsed.value, 99)))} title="Expand all">
                  <ChevronsUpDown /> Expand all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(['[]']))} title="Collapse all">
                  <ChevronsDownUp /> Collapse
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => void copyText(pretty, isJson ? 'Copied formatted JSON' : 'Copied value')}>
              <Copy /> Copy
            </Button>
            {isJson && (
              <Button size="sm" variant="ghost" onClick={() => void copyText(JSON.stringify(parsed.value), 'Copied minified JSON')}>
                Minified
              </Button>
            )}
            {target.onSave && mode !== 'edit' && (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pencil /> Edit
              </Button>
            )}
          </div>
        </div>
        {mode !== 'edit' && target.value !== null && (
          <ValueFindBar ref={findRef} query={query} onQuery={setQuery} current={current} total={total} onStep={step} />
        )}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto p-3">
          {target.value === null && mode !== 'edit' && <p className="italic text-muted-foreground">NULL</p>}
          {isJson && mode === 'tree' && (
            <JsonTree
              value={parsed.value}
              column={target.column}
              expanded={expanded}
              query={query}
              currentKey={mode === 'tree' && treeHits[current] ? JSON.stringify(treeHits[current]) : null}
              onToggle={(k) =>
                setExpanded((s) => {
                  const n = new Set(s)
                  if (n.has(k)) n.delete(k)
                  else n.add(k)
                  return n
                })
              }
            />
          )}
          {mode === 'raw' && target.value !== null && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed select-text">
              <Highlight text={pretty} query={query} current={current} />
            </pre>
          )}
          {mode === 'edit' && (
            <div className="flex h-full flex-col gap-2">
              <textarea
                autoFocus
                className="min-h-0 flex-1 resize-none rounded-md border bg-background p-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring select-text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              {draftError && <p className="text-[11px] text-red-400">{draftError}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(isJson ? 'tree' : 'raw')}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={() => (target.onSave?.(null), onClose())}>Set NULL</Button>
                <Button size="sm" onClick={save}>Stage change</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Dialog>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('rounded px-2 py-0.5 text-xs', active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}
