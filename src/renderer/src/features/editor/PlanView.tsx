/**
 * EXPLAIN visualiser: an indented plan tree with a bar per node (self time for
 * ANALYZE, total cost otherwise), estimated vs actual rows with misestimate
 * warnings, and node details (filters, index / join conditions, sort keys).
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, X } from 'lucide-react'
import type { ExplainResult } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { copyText } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { formatMs, parsePlan, type PlanNode, type PlanSummary } from './planTree'

const fmtNum = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function PlanView({ result, onClose }: { result: ExplainResult; onClose: () => void }) {
  const parsed = useMemo((): PlanSummary | Error => {
    try {
      return parsePlan(result.plan)
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  }, [result])

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Query plan">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{result.analyzed ? 'EXPLAIN ANALYZE' : 'EXPLAIN'}</span>
        {!(parsed instanceof Error) && (
          <>
            <span>cost {fmtNum(parsed.totalCost)}</span>
            {parsed.planningMs !== null && <span>planning {formatMs(parsed.planningMs)}</span>}
            {parsed.executionMs !== null && <span>execution {formatMs(parsed.executionMs)}</span>}
            {result.analyzed && <Badge>rolled back</Badge>}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copyText(JSON.stringify(result.plan, null, 2), 'Plan JSON copied')} title="Copy the raw JSON plan">
            <Copy /> JSON
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} title="Back to results" aria-label="Close plan">
            <X />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1 font-mono text-[11px]">
        {parsed instanceof Error ? (
          <ErrorBanner error={{ code: 'UNKNOWN', message: parsed.message }} />
        ) : (
          parsed.nodes.map((n) => <PlanRow key={n.id} node={n} summary={parsed} />)
        )}
      </div>
    </div>
  )
}

function PlanRow({ node: n, summary }: { node: PlanNode; summary: PlanSummary }) {
  const [open, setOpen] = useState(false)
  const weight = summary.analyzed ? (n.selfMs ?? 0) : n.totalCost
  const pct = summary.maxWeight > 0 ? (weight / summary.maxWeight) * 100 : 0
  const hot = pct >= 60
  const bad = n.misestimate !== null && n.misestimate >= 10
  return (
    <div className="rounded hover:bg-accent/40" data-testid="plan-node">
      <div className="flex items-center gap-2 py-0.5 pr-2" style={{ paddingLeft: `${n.depth * 16 + 4}px` }}>
        <button
          className={cn('size-3.5 shrink-0 text-muted-foreground', !n.details.length && 'invisible')}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Hide details' : 'Show details'}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span className={cn('font-semibold', hot && 'text-red-400')}>{n.nodeType}</span>
        <span className="truncate text-muted-foreground">{n.target}</span>
        <div className="ml-auto flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
          <span title="Rows: estimated → actual">
            {fmtNum(n.planRows)}
            {n.actualRows !== null && <> → {fmtNum(n.actualRows)}</>}
            {n.loops !== null && n.loops > 1 && <span className="opacity-70"> ×{n.loops}</span>}
          </span>
          {bad && (
            <span className="flex items-center gap-0.5 text-amber-400" title="Row estimate was off by this factor. Consider ANALYZE on the table or better statistics.">
              <AlertTriangle className="size-3" />×{fmtNum(n.misestimate ?? 0)}
            </span>
          )}
          <span className="w-20 text-right" title="Startup … total cost">
            {fmtNum(n.totalCost)}
          </span>
          {summary.analyzed && (
            <span className="w-16 text-right" title="Self time (excluding children)">
              {n.selfMs !== null ? formatMs(n.selfMs) : ''}
            </span>
          )}
          <div className="h-1.5 w-24 overflow-hidden rounded bg-muted" title={`${pct.toFixed(0)}% of the heaviest node`}>
            <div className={cn('h-full', hot ? 'bg-red-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      {open && (
        <div className="pb-1 text-muted-foreground" style={{ paddingLeft: `${n.depth * 16 + 26}px` }}>
          {n.details.map(([k, v]) => (
            <div key={k} className="truncate" title={v}>
              <span className="text-foreground/80">{k}:</span> {v}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
