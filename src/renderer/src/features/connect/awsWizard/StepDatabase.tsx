/** Wizard step 2: searchable list of Postgres RDS instances and clusters in the chosen region. */
import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import type { RdsDatabase } from '@shared/types/aws'
import { Button } from '@renderer/components/ui/button'
import { Badge, Input, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { call } from '@renderer/lib/ipc'
import { useAsync } from '@renderer/lib/useAsync'
import { cn } from '@renderer/lib/utils'

export function StepDatabase({
  profile,
  region,
  onBack,
  onNext
}: {
  profile: string
  region: string
  onBack: () => void
  onNext: (db: RdsDatabase) => void
}) {
  const dbs = useAsync(() => call('aws:listRdsDatabases', { profile, region }), [profile, region])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return (dbs.data ?? []).filter((d) => !q || `${d.identifier} ${d.endpoint ?? ''} ${d.engine}`.toLowerCase().includes(q))
  }, [dbs.data, query])
  const chosen = dbs.data?.find((d) => d.identifier === selected)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input autoFocus className="pl-7" placeholder={`Search databases in ${region}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button variant="ghost" size="icon" onClick={() => void dbs.reload()} title="Refresh">
          <RefreshCw />
        </Button>
      </div>

      {dbs.error && <ErrorBanner error={dbs.error} onRetry={() => void dbs.reload()} />}
      <div className="h-72 overflow-auto rounded-md border">
        {dbs.loading && (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Spinner /> Discovering RDS databases…
          </div>
        )}
        {!dbs.loading && filtered.length === 0 && !dbs.error && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No PostgreSQL databases found in {region}.
          </div>
        )}
        {!dbs.loading &&
          filtered.map((d) => (
            <button
              key={d.identifier}
              onClick={() => setSelected(d.identifier)}
              onDoubleClick={() => onNext(d)}
              className={cn(
                'flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent/50',
                selected === d.identifier && 'bg-accent'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.identifier}</span>
                  {d.kind === 'cluster' && <Badge tone="blue">cluster</Badge>}
                  <Badge tone={d.publiclyAccessible ? 'amber' : 'neutral'}>{d.publiclyAccessible ? 'public' : 'private'}</Badge>
                  {d.iamAuthEnabled && <Badge tone="green">IAM</Badge>}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {d.endpoint ? `${d.endpoint}:${d.port}` : 'no endpoint yet'}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                <div>
                  {d.engine} {d.engineVersion}
                </div>
                <div className={d.status === 'available' ? 'text-emerald-400' : 'text-amber-400'}>{d.status}</div>
              </div>
            </button>
          ))}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={() => chosen && onNext(chosen)} disabled={!chosen?.endpoint}>
          Next: connect
        </Button>
      </div>
    </div>
  )
}
