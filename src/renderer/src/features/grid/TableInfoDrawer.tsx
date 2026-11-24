/**
 * Table info panel (ⓘ in the table toolbar): overview stats, indexes,
 * constraints / foreign keys / triggers, and reconstructed DDL with a copy
 * button. Data comes from db:getTableDetails and is fetched each time it opens,
 * so stats are fresh.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import type { TableDetails } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { Dialog, SheetContent } from '@renderer/components/ui/dialog'
import { Badge, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'

const TABS = ['Overview', 'Indexes', 'Constraints', 'DDL'] as const
type InfoTab = (typeof TABS)[number]

function bytes(n: number | null): string {
  if (n === null) return '–'
  const u = ['bytes', 'kB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) (v /= 1024, i++)
  return i === 0 ? `${v} bytes` : `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />} {done ? 'Copied' : label}
    </button>
  )
}

function Code({ children }: { children: string }) {
  return <pre className="whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono text-[11px] leading-relaxed select-text">{children}</pre>
}

export function TableInfoDrawer({
  open,
  onOpenChange,
  sessionId,
  schema,
  table
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  sessionId: string
  schema: string
  table: string
}) {
  const [tab, setTab] = useState<InfoTab>('Overview')
  const [data, setData] = useState<TableDetails | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    if (!open) return
    setData(null)
    setError(null)
    call('db:getTableDetails', { sessionId, schema, table })
      .then(setData)
      .catch((e: unknown) => setError(asAppError(e)))
  }, [open, sessionId, schema, table])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent title={`${schema}.${table}`} description={data ? `${data.kind}${data.owner ? ` · owner ${data.owner}` : ''}` : 'Loading table details…'}>
        <div className="flex shrink-0 gap-1 border-b px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('-mb-px border-b-2 px-2.5 pb-1.5 text-xs', tab === t ? 'border-sky-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t}
              {data && t === 'Indexes' && <span className="ml-1 text-[10px] text-muted-foreground">{data.indexes.length}</span>}
              {data && t === 'Constraints' && (
                <span className="ml-1 text-[10px] text-muted-foreground">{data.constraints.length + data.referencedBy.length + data.triggers.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
          {!data && !error && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Reading catalog…
            </div>
          )}
          {error && <ErrorBanner error={error} />}

          {data && tab === 'Overview' && (
            <div className="space-y-4">
              {data.comment && <p className="rounded border bg-background p-2 text-muted-foreground select-text">{data.comment}</p>}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                {data.stats.map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1" title={s.hint}>
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="font-mono tabular-nums select-text">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {data && tab === 'Indexes' && (
            <div className="space-y-2">
              {data.indexes.length === 0 && <p className="text-muted-foreground">No indexes.</p>}
              {data.indexes.map((i) => (
                <div key={i.name} className="space-y-1.5 rounded border p-2">
                  <div className="flex items-center gap-2">
                    {i.primary && <KeyRound className="size-3 text-amber-400" />}
                    <span className="font-mono font-medium select-text">{i.name}</span>
                    {i.primary ? <Badge tone="amber">primary</Badge> : i.unique ? <Badge tone="blue">unique</Badge> : null}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {bytes(i.sizeBytes)} · {i.scans === null ? '–' : i.scans.toLocaleString('en-US')} scans
                    </span>
                    {i.scans === 0 && !i.primary && <Badge tone="red" title="Never used since stats reset: candidate for removal">unused</Badge>}
                  </div>
                  <Code>{i.definition}</Code>
                </div>
              ))}
            </div>
          )}

          {data && tab === 'Constraints' && (
            <div className="space-y-4">
              <Section title="Constraints" empty="No constraints.">
                {data.constraints.map((c) => (
                  <Item key={c.name} name={c.name} badge={c.type} def={c.definition} />
                ))}
              </Section>
              <Section title="Referenced by (foreign keys pointing here)" empty="No other table references this one.">
                {data.referencedBy.map((r) => (
                  <Item key={`${r.table}.${r.name}`} name={`${r.table} · ${r.name}`} def={r.definition} />
                ))}
              </Section>
              <Section title="Triggers" empty="No triggers.">
                {data.triggers.map((t) => (
                  <Item key={t.name} name={t.name} def={t.definition} />
                ))}
              </Section>
            </div>
          )}

          {data && tab === 'DDL' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Reconstructed from the catalog (no grants, ownership or storage options).</span>
                {data.ddl && <CopyButton text={data.ddl} label="Copy DDL" />}
              </div>
              <Code>{data.ddl ?? 'This engine cannot produce DDL for this object.'}</Code>
            </div>
          )}
        </div>
      </SheetContent>
    </Dialog>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children.length === 0 ? <p className="text-muted-foreground">{empty}</p> : children}
    </div>
  )
}

function Item({ name, badge, def }: { name: string; badge?: string; def: string }) {
  return (
    <div className="space-y-1 rounded border p-2">
      <div className="flex items-center gap-2">
        <span className="font-mono font-medium select-text">{name}</span>
        {badge && <Badge>{badge}</Badge>}
      </div>
      <Code>{def}</Code>
    </div>
  )
}
