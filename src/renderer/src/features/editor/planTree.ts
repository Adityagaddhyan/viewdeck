/**
 * Pure model for the EXPLAIN visualiser: turns Postgres `EXPLAIN (FORMAT JSON)`
 * output into a flat, depth-annotated node list with costs, row estimates and
 * (for ANALYZE) actual time, self time and misestimate factors.
 */

/** One plan node, flattened in display (pre-)order. */
export interface PlanNode {
  id: number
  depth: number
  nodeType: string
  /** "on public.orders o", "using orders_pkey", etc. */
  target: string
  startupCost: number
  totalCost: number
  planRows: number
  actualRows: number | null
  loops: number | null
  /** Inclusive wall time across loops (ms), ANALYZE only. */
  actualTotalMs: number | null
  /** Time spent in this node alone (inclusive minus children), ANALYZE only. */
  selfMs: number | null
  /** max(actual/plan, plan/actual), ANALYZE only. >= 10 is a bad estimate. */
  misestimate: number | null
  /** Filter / Index Cond / Join cond / Sort Key, etc. for the detail line. */
  details: Array<[string, string]>
}

export interface PlanSummary {
  nodes: PlanNode[]
  analyzed: boolean
  planningMs: number | null
  executionMs: number | null
  totalCost: number
  /** Max of selfMs (ANALYZE) or totalCost (plain), used to scale bars. */
  maxWeight: number
}

type Raw = Record<string, unknown>

const DETAIL_KEYS = [
  'Index Cond',
  'Recheck Cond',
  'Filter',
  'Rows Removed by Filter',
  'Join Filter',
  'Hash Cond',
  'Merge Cond',
  'Sort Key',
  'Sort Method',
  'Group Key',
  'Output',
  'Shared Hit Blocks',
  'Shared Read Blocks'
]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function describeTarget(n: Raw): string {
  const parts: string[] = []
  const rel = n['Relation Name']
  if (typeof rel === 'string') {
    const schema = typeof n['Schema'] === 'string' ? `${n['Schema']}.` : ''
    const alias = typeof n['Alias'] === 'string' && n['Alias'] !== rel ? ` ${n['Alias']}` : ''
    parts.push(`on ${schema}${rel}${alias}`)
  }
  if (typeof n['Index Name'] === 'string') parts.push(`using ${n['Index Name']}`)
  if (typeof n['CTE Name'] === 'string') parts.push(`CTE ${n['CTE Name']}`)
  if (typeof n['Function Name'] === 'string') parts.push(`${n['Function Name']}()`)
  if (typeof n['Join Type'] === 'string' && !String(n['Node Type']).includes(String(n['Join Type']))) parts.push(`${n['Join Type']} join`)
  return parts.join(' ')
}

function formatDetail(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(', ')
  return String(v)
}

/** Parses the JSON plan (the array Postgres returns) into a summary. Throws on a shape it doesn't recognise. */
export function parsePlan(json: unknown): PlanSummary {
  const top = (Array.isArray(json) ? json[0] : json) as Raw | undefined
  const root = top?.['Plan'] as Raw | undefined
  if (!root || typeof root !== 'object') throw new Error('Unrecognised EXPLAIN output')
  const nodes: PlanNode[] = []
  let analyzed = false

  const walk = (n: Raw, depth: number): number | null => {
    const id = nodes.length
    const loops = num(n['Actual Loops'])
    const perLoop = num(n['Actual Total Time'])
    const actualTotalMs = perLoop !== null ? perLoop * (loops ?? 1) : null
    if (actualTotalMs !== null) analyzed = true
    const planRows = num(n['Plan Rows']) ?? 0
    const actualRows = num(n['Actual Rows'])
    const details: Array<[string, string]> = []
    for (const k of DETAIL_KEYS) if (n[k] !== undefined && k !== 'Output') details.push([k, formatDetail(n[k])])
    const node: PlanNode = {
      id,
      depth,
      nodeType: String(n['Node Type'] ?? '?') + (n['Parallel Aware'] === true ? ' (parallel)' : ''),
      target: describeTarget(n),
      startupCost: num(n['Startup Cost']) ?? 0,
      totalCost: num(n['Total Cost']) ?? 0,
      planRows,
      actualRows,
      loops,
      actualTotalMs,
      selfMs: null,
      misestimate: actualRows !== null ? misestimate(planRows, actualRows) : null,
      details
    }
    nodes.push(node)
    let childMs = 0
    for (const child of (n['Plans'] as Raw[] | undefined) ?? []) {
      // InitPlan/SubPlan children run separately; still subtract, Postgres includes them in the parent.
      childMs += walk(child, depth + 1) ?? 0
    }
    if (actualTotalMs !== null) node.selfMs = Math.max(0, actualTotalMs - childMs)
    return actualTotalMs
  }
  walk(root, 0)

  const weights = nodes.map((n) => (analyzed ? (n.selfMs ?? 0) : n.totalCost))
  return {
    nodes,
    analyzed,
    planningMs: num(top?.['Planning Time']),
    executionMs: num(top?.['Execution Time']),
    totalCost: num(root['Total Cost']) ?? 0,
    maxWeight: Math.max(0, ...weights)
  }
}

/** How far off the row estimate was, as a factor (1 = perfect). Zero rows count as one. */
export function misestimate(planned: number, actual: number): number {
  const p = Math.max(1, planned)
  const a = Math.max(1, actual)
  return Math.round((Math.max(p / a, a / p)) * 10) / 10
}

/** Compact ms for plan nodes: 0.012 ms, 4.3 ms, 1.24 s. */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 10) return `${ms.toFixed(0)} ms`
  if (ms >= 1) return `${ms.toFixed(1)} ms`
  return `${ms.toFixed(3)} ms`
}
