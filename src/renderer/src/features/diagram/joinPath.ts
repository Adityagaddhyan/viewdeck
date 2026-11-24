import type { DiagramEdge, DiagramModel, DiagramNode, NodeId } from './graphModel'

interface Link {
  edge: DiagramEdge
  other: NodeId
}

const linkCache = new WeakMap<DiagramModel, Map<NodeId, Link[]>>()

/** Undirected incidence lists (self-loops dropped), cached per model since models are immutable. */
function links(model: DiagramModel): Map<NodeId, Link[]> {
  const cached = linkCache.get(model)
  if (cached) return cached
  const out = new Map<NodeId, Link[]>()
  const add = (a: NodeId, link: Link): void => {
    const list = out.get(a)
    if (list) list.push(link)
    else out.set(a, [link])
  }
  for (const edge of model.edges) {
    if (edge.from === edge.to) continue
    add(edge.from, { edge, other: edge.to })
    add(edge.to, { edge, other: edge.from })
  }
  linkCache.set(model, out)
  return out
}

/**
 * Tables within `depth` hops of `id`, ignoring edge direction (a child and its parent are
 * equally "related" when focusing a table). Includes `id` itself; depth 0 → just `id`.
 */
export function neighborhood(model: DiagramModel, id: NodeId, depth: number): Set<NodeId> {
  const adj = links(model)
  const seen = new Set<NodeId>([id])
  let frontier: NodeId[] = [id]
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: NodeId[] = []
    for (const cur of frontier) {
      for (const { other } of adj.get(cur) ?? []) {
        if (!seen.has(other)) {
          seen.add(other)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  return seen
}

/** Real FKs are guaranteed join keys; inferred ones are guesses, so a path through them costs more. */
const weight = (e: DiagramEdge): number => (e.kind === 'fk' ? 1 : 1.5)

/**
 * Shortest undirected join path between two tables (Dijkstra; FK hop = 1, inferred =
 * 1.5, so a declared route wins over an equally short guessed one). Ties resolve by edge
 * order in the model, so the answer is deterministic. [] when from === to, null when
 * either table is unknown or no path exists.
 */
export function findJoinPath(model: DiagramModel, from: NodeId, to: NodeId): DiagramEdge[] | null {
  if (!model.byId.has(from) || !model.byId.has(to)) return null
  if (from === to) return []
  const adj = links(model)
  const dist = new Map<NodeId, number>([[from, 0]])
  const prev = new Map<NodeId, Link>()
  const done = new Set<NodeId>()
  const open = new Set<NodeId>([from])
  while (open.size > 0) {
    let cur: NodeId | null = null
    let best = Infinity
    for (const id of open) {
      const d = dist.get(id) ?? Infinity
      if (d < best || (d === best && cur !== null && id < cur)) {
        best = d
        cur = id
      }
    }
    if (cur === null) break
    if (cur === to) break
    open.delete(cur)
    done.add(cur)
    for (const link of adj.get(cur) ?? []) {
      if (done.has(link.other)) continue
      const nd = best + weight(link.edge)
      if (nd < (dist.get(link.other) ?? Infinity) - 1e-9) {
        dist.set(link.other, nd)
        prev.set(link.other, { edge: link.edge, other: cur })
        open.add(link.other)
      }
    }
  }
  if (!prev.has(to)) return null
  const path: DiagramEdge[] = []
  for (let at = to; at !== from; ) {
    const step = prev.get(at)
    if (!step) return null
    path.unshift(step.edge)
    at = step.other
  }
  return path
}

/** Postgres reserved words that cannot be bare identifiers or aliases. */
const RESERVED = new Set(
  ('all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate column ' +
    'constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp ' +
    'current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant ' +
    'group having ilike in initially inner intersect into is isnull join lateral leading left like limit localtime ' +
    'localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references returning ' +
    'right select session_user similar some symmetric table tablesample then to trailing true union unique user using ' +
    'variadic verbose when where window with').split(' ')
)

/** Quotes an identifier only when it would not survive unquoted (case, symbols, reserved words). */
export function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

/** Short alias from the first letter of each word (`order_items` → `oi`), numbered on clashes. */
function makeAlias(name: string, used: Set<string>): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let base = words.map((w) => w[0]).join('')
  if (!/^[a-z_]/.test(base)) base = `t${base}`
  let alias = base
  for (let i = 2; used.has(alias) || RESERVED.has(alias); i++) alias = `${base}${i}`
  used.add(alias)
  return alias
}

/** Table reference: schema-qualified only when outside the model's schema. */
function tableRef(model: DiagramModel, node: DiagramNode): string {
  const name = quoteIdent(node.name)
  return node.schema === model.schema ? name : `${quoteIdent(node.schema)}.${name}`
}

/**
 * Readable SELECT that walks `path` from `from`, one JOIN per edge. Each ON clause puts
 * the newly joined table first and is oriented by traversal direction (child → parent
 * joins on the parent's key, parent → child on the child's referencing columns), so the
 * same edges read naturally from either end. Plain JOINs keep it a starting point, not a
 * guess at the user's outer-join intent.
 */
export function joinPathSql(model: DiagramModel, from: NodeId, path: DiagramEdge[]): string {
  const start = model.byId.get(from)
  if (!start) return ''
  const used = new Set<string>()
  let prevAlias = makeAlias(start.name, used)
  const lines = ['SELECT *', `FROM ${tableRef(model, start)} ${prevAlias}`]
  let current = from
  for (const edge of path) {
    const forward = edge.from === current
    const nextId = forward ? edge.to : edge.from
    const next = model.byId.get(nextId)
    if (!next) break
    const alias = makeAlias(next.name, used)
    const prevCols = forward ? edge.fromColumns : edge.toColumns
    const nextCols = forward ? edge.toColumns : edge.fromColumns
    const on = nextCols.map((c, i) => `${alias}.${quoteIdent(c)} = ${prevAlias}.${quoteIdent(prevCols[i] ?? '')}`).join(' AND ')
    lines.push(`JOIN ${tableRef(model, next)} ${alias} ON ${on}`)
    prevAlias = alias
    current = nextId
  }
  lines.push('LIMIT 100;')
  return lines.join('\n')
}
