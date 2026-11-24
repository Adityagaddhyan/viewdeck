/**
 * Side panel for inspecting one cell. JSON (json/jsonb columns, or text that is
 * a JSON object/array) opens as a collapsible tree with expand/collapse all and
 * a pretty "Raw" view. Other values show wrapped. When `onSave` is provided
 * (session unlocked, row editable), the value can be edited, and the edit is
 * STAGED like any grid edit (ADR-003), never written directly.
 */
import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    if (!target) return
    setMode(parsed.ok ? 'tree' : 'raw')
    setExpanded(new Set(parsed.ok ? containerPaths(parsed.value, 2) : []))
    setDraftError(null)
  }, [target, parsed])

  if (!target) return null
  const isJson = parsed.ok
  const pretty = isJson ? JSON.stringify(parsed.value, null, 2) : target.value === null ? '' : String(target.value)

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
      <SheetContent title={target.column} description={`${target.dataType}${target.value === null ? ' · NULL' : ` · ${pretty.length.toLocaleString()} chars`}`}>
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
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {target.value === null && mode !== 'edit' && <p className="italic text-muted-foreground">NULL</p>}
          {isJson && mode === 'tree' && (
            <JsonTree
              value={parsed.value}
              column={target.column}
              expanded={expanded}
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
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed select-text">{pretty}</pre>
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
