/**
 * Lazily loaded Functions / Sequences / Types groups under a schema in the
 * sidebar. Clicking an object opens its CREATE statement in a new query tab.
 */
import { useState } from 'react'
import { Binary, ChevronRight, FunctionSquare, ListOrdered, Shapes } from 'lucide-react'
import type { SchemaObjects } from '@shared/types/driver'
import { Spinner } from '@renderer/components/ui/primitives'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'

type Kind = 'function' | 'sequence' | 'type'

export function SchemaObjectsGroups({ schema, filter }: { schema: string; filter: string }) {
  const sessionId = useAppState((s) => s.session?.id ?? '')
  const [objs, setObjs] = useState<SchemaObjects | null>(null)
  const [open, setOpen] = useState<Record<Kind, boolean>>({ function: false, sequence: false, type: false })
  const [loading, setLoading] = useState(false)

  const ensure = async (): Promise<void> => {
    if (objs || loading) return
    setLoading(true)
    try {
      setObjs(await call('db:listSchemaObjects', { sessionId, schema }))
    } catch (e) {
      actions.showToast(asAppError(e).message)
    } finally {
      setLoading(false)
    }
  }
  const openDef = async (kind: Kind, id: string, label: string): Promise<void> => {
    try {
      const def = await call('db:getObjectDefinition', { sessionId, kind, id })
      actions.newQueryTab(`-- ${kind} ${schema}.${label}\n${def}`)
    } catch (e) {
      actions.showToast(asAppError(e).message)
    }
  }

  const groups: Array<{ kind: Kind; label: string; icon: typeof Binary; items: Array<{ id: string; label: string; detail?: string }> }> = [
    { kind: 'function', label: 'Functions', icon: FunctionSquare, items: (objs?.functions ?? []).map((f) => ({ id: f.id, label: `${f.name}(${f.signature})`, detail: f.kind === 'function' ? f.returns : f.kind })) },
    { kind: 'sequence', label: 'Sequences', icon: ListOrdered, items: (objs?.sequences ?? []).map((q) => ({ id: q.id, label: q.name })) },
    { kind: 'type', label: 'Types', icon: Shapes, items: (objs?.types ?? []).map((t) => ({ id: t.id, label: t.name, detail: t.kind })) }
  ]

  return (
    <>
      {groups.map((g) => {
        const shown = g.items.filter((i) => !filter || i.label.toLowerCase().includes(filter))
        if (objs && shown.length === 0) return null
        return (
          <div key={g.kind}>
            <button
              className="flex h-6 w-full items-center gap-1 rounded px-1 text-left text-muted-foreground hover:bg-accent/60"
              onClick={() => {
                setOpen((o) => ({ ...o, [g.kind]: !o[g.kind] }))
                void ensure()
              }}
            >
              <ChevronRight className={cn('size-3 shrink-0 transition-transform', open[g.kind] && 'rotate-90')} />
              <g.icon className="size-3 shrink-0" />
              <span className="truncate text-[11px]">{g.label}</span>
              {objs && <span className="ml-auto pr-1 text-[10px]">{g.items.length}</span>}
            </button>
            {open[g.kind] && (
              <div className="ml-3 border-l border-border/60 pl-1">
                {loading && <Spinner className="m-1" />}
                {shown.map((i) => (
                  <button
                    key={i.id}
                    className="flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-accent/60"
                    title={`${i.label}${i.detail ? ` → ${i.detail}` : ''}. Click to open its definition.`}
                    onClick={() => void openDef(g.kind, i.id, i.label)}
                  >
                    <span className="truncate font-mono text-[11px]">{i.label}</span>
                    {i.detail && <span className="ml-auto shrink-0 truncate pl-1 text-[10px] text-muted-foreground">{i.detail}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
