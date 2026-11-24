import type { GraphColumn, GraphTable, ReferentialAction, SchemaGraph } from '@shared/types/diagram'
import { edgeShape, inferRelationships, tableId } from './inferRelations'

import { mergeSmallClusters } from './clusterMerge'
export { inferRelationships, tableId } from './inferRelations'
export { findJoinPath, joinPathSql, neighborhood } from './joinPath'

/** Node id = `${schema}.${table}`. Schema-qualified so cross-schema stubs never collide. */
export type NodeId = string

/** One table card in the ER diagram. */
export interface DiagramNode {
  id: NodeId
  schema: string
  name: string
  external: boolean
  kind: GraphTable['kind']
  columns: GraphColumn[]
  primaryKey: string[]
  /** Columns that are PK or part of any (real or inferred) relationship, in ordinal order: what the compact card shows. */
  keyColumns: string[]
  /** Edges pointing at this table (real + inferred if included); a self-reference counts once here and once in outDegree. */
  inDegree: number
  outDegree: number
  /** Cluster id (index into DiagramModel.clusters). */
  cluster: number
  rowEstimate: number | null
  totalBytes: number | null
  comment: string | null
}

/** Parent multiplicity per child row is always "at most one"; this says how many children per parent. */
export type Cardinality = 'one-to-one' | 'many-to-one'

/** One relationship line: a declared FK or an inferred (naming-convention) guess. */
export interface DiagramEdge {
  /** Stable across reloads: `fk:${schema}.${constraint}` or `inf:${from}.${col}->${to}`. */
  id: string
  /** Referencing (child) table. */
  from: NodeId
  /** Referenced (parent) table. */
  to: NodeId
  fromColumns: string[]
  toColumns: string[]
  kind: 'fk' | 'inferred'
  /** All fromColumns NOT NULL → parent is mandatory ("exactly one"); else optional ("zero or one"). */
  required: boolean
  /** One-to-one when fromColumns equal the child's PK or a unique key (as sets). */
  cardinality: Cardinality
  /** Null for inferred edges (no constraint, no action). */
  onDelete: ReferentialAction | null
  onUpdate: ReferentialAction | null
  constraintName: string | null
  selfReference: boolean
  /** More than one column. */
  composite: boolean
  /** Inferred only. */
  confidence?: 'high' | 'medium'
  /** Inferred only: human-readable justification shown in the edge tooltip. */
  reason?: string
}

/** A group of closely related tables, laid out together. */
export interface DiagramCluster {
  id: number
  /** Name of the cluster's most connected table, or "Unconnected" for the singleton bucket. */
  label: string
  size: number
  nodeIds: NodeId[]
}

/** Everything the diagram view renders, derived once per graph. */
export interface DiagramModel {
  /** The schema the graph was read for (join SQL omits this qualifier). */
  schema: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** Sorted by size desc; `cluster` on each node indexes this array. */
  clusters: DiagramCluster[]
  /** Up to 10 most connected non-external nodes with degree >= 3 (ties by name). */
  hubs: NodeId[]
  /** Non-external nodes with no edges at all, sorted by name. */
  isolated: NodeId[]
  byId: Map<NodeId, DiagramNode>
}

/** Model options. `inferred` adds naming-convention guesses for schemas without FKs. */
export interface BuildOptions {
  inferred: boolean
}

/** Components above this size are split into communities so one giant blob stays readable. */
const SPLIT_THRESHOLD = 25
const UNCONNECTED = 'Unconnected'

const degree = (n: DiagramNode): number => n.inDegree + n.outDegree
const byName = (a: DiagramNode, b: DiagramNode): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/**
 * Turns a SchemaGraph into the ER-diagram model: nodes, typed edges (cardinality and
 * optionality from nullability and keys), clusters, hubs and isolated tables. Pure and
 * deterministic (same graph → same ids, order and clusters), so layouts and selections
 * survive refreshes. FKs whose endpoints are missing from the graph are dropped.
 */
export function buildDiagramModel(graph: SchemaGraph, opts: BuildOptions): DiagramModel {
  const tables = new Map<NodeId, GraphTable>()
  for (const t of graph.tables) tables.set(tableId(t), t)

  const edges: DiagramEdge[] = []
  for (const fk of graph.foreignKeys) {
    const from = `${fk.fromSchema}.${fk.fromTable}`
    const to = `${fk.toSchema}.${fk.toTable}`
    const child = tables.get(from)
    if (child === undefined || !tables.has(to)) continue
    edges.push({
      id: `fk:${fk.fromSchema}.${fk.name}`,
      from,
      to,
      fromColumns: fk.fromColumns,
      toColumns: fk.toColumns,
      kind: 'fk',
      ...edgeShape(child, fk.fromColumns),
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
      constraintName: fk.name,
      selfReference: from === to,
      composite: fk.fromColumns.length > 1
    })
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id))
  if (opts.inferred) edges.push(...inferRelationships(graph))

  const keys = new Map<NodeId, Set<string>>()
  const addKeys = (id: NodeId, cols: string[]): void => {
    const set = keys.get(id) ?? new Set<string>()
    for (const c of cols) set.add(c)
    keys.set(id, set)
  }
  const inDeg = new Map<NodeId, number>()
  const outDeg = new Map<NodeId, number>()
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1)
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
    addKeys(e.from, e.fromColumns)
    addKeys(e.to, e.toColumns)
  }

  const nodes: DiagramNode[] = [...tables.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, t]) => {
      const k = keys.get(id)
      return {
        id,
        schema: t.schema,
        name: t.name,
        external: t.external,
        kind: t.kind,
        columns: t.columns,
        primaryKey: t.primaryKey,
        keyColumns: t.columns.map((c) => c.name).filter((c) => t.primaryKey.includes(c) || k?.has(c) === true),
        inDegree: inDeg.get(id) ?? 0,
        outDegree: outDeg.get(id) ?? 0,
        cluster: 0,
        rowEstimate: t.rowEstimate,
        totalBytes: t.totalBytes,
        comment: t.comment
      }
    })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const clusters = buildClusters(nodes, edges, byId)
  for (const c of clusters) for (const id of c.nodeIds) {
    const n = byId.get(id)
    if (n) n.cluster = c.id
  }

  const internal = nodes.filter((n) => !n.external)
  const hubs = internal
    .filter((n) => degree(n) >= 3)
    .sort((a, b) => degree(b) - degree(a) || byName(a, b))
    .slice(0, 10)
    .map((n) => n.id)
  const isolated = internal.filter((n) => degree(n) === 0).sort(byName).map((n) => n.id)

  return { schema: graph.schema, nodes, edges, clusters, hubs, isolated, byId }
}

/** Undirected weighted adjacency (edge multiplicity as weight), self-loops dropped. */
function adjacency(nodes: DiagramNode[], edges: DiagramEdge[]): Map<NodeId, Map<NodeId, number>> {
  const adj = new Map<NodeId, Map<NodeId, number>>(nodes.map((n) => [n.id, new Map()]))
  for (const e of edges) {
    if (e.from === e.to) continue
    const a = adj.get(e.from)
    const b = adj.get(e.to)
    if (!a || !b) continue
    a.set(e.to, (a.get(e.to) ?? 0) + 1)
    b.set(e.from, (b.get(e.from) ?? 0) + 1)
  }
  return adj
}

/**
 * Connected components, with big components split by one deterministic Louvain
 * local-moving phase. Label propagation tends to collapse hub-heavy schemas into one
 * label; modularity keeps leaf tables with their hub but separates distinct areas.
 */
function buildClusters(nodes: DiagramNode[], edges: DiagramEdge[], byId: Map<NodeId, DiagramNode>): DiagramCluster[] {
  const adj = adjacency(nodes, edges)
  const seen = new Set<NodeId>()
  const groups: NodeId[][] = []
  const singletons: NodeId[] = []
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    const comp: NodeId[] = []
    const queue = [n.id]
    seen.add(n.id)
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i] as NodeId
      comp.push(cur)
      for (const next of [...(adj.get(cur)?.keys() ?? [])].sort()) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    if (comp.length === 1) singletons.push(n.id)
    else if (comp.length > SPLIT_THRESHOLD) groups.push(...mergeSmallClusters(louvain(comp.sort(), adj), adj))
    else groups.push(comp.sort())
  }

  const labelOf = (ids: NodeId[]): string => {
    const members = ids.map((id) => byId.get(id)).filter((n): n is DiagramNode => n !== undefined)
    members.sort((a, b) => degree(b) - degree(a) || byName(a, b))
    return members[0]?.name ?? ''
  }
  const raw = groups.map((ids) => ({ label: labelOf(ids), nodeIds: ids }))
  if (singletons.length > 0) raw.push({ label: UNCONNECTED, nodeIds: singletons.sort() })
  raw.sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.label.localeCompare(b.label) || (a.nodeIds[0] ?? '').localeCompare(b.nodeIds[0] ?? ''))
  return raw.map((c, id) => ({ id, label: c.label, size: c.nodeIds.length, nodeIds: c.nodeIds }))
}

/** One Louvain local-moving phase over `ids` (sorted), ties broken by smallest community. */
function louvain(ids: NodeId[], adj: Map<NodeId, Map<NodeId, number>>): NodeId[][] {
  const index = new Map(ids.map((id, i) => [id, i]))
  const comm = ids.map((_, i) => i)
  const k = ids.map((id) => [...(adj.get(id)?.values() ?? [])].reduce((s, w) => s + w, 0))
  const tot = [...k]
  const m2 = k.reduce((s, w) => s + w, 0)
  if (m2 === 0) return [ids]

  for (let pass = 0, moved = true; moved && pass < 20; pass++) {
    moved = false
    ids.forEach((id, i) => {
      const own = comm[i] as number
      const ki = k[i] as number
      const links = new Map<number, number>()
      for (const [nb, w] of adj.get(id) ?? []) {
        const c = comm[index.get(nb) as number] as number
        links.set(c, (links.get(c) ?? 0) + w)
      }
      tot[own] = (tot[own] as number) - ki
      let best = own
      let bestGain = (links.get(own) ?? 0) - ((tot[own] as number) * ki) / m2
      for (const [c, w] of [...links.entries()].sort((a, b) => a[0] - b[0])) {
        const gain = w - ((tot[c] as number) * ki) / m2
        if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) {
          best = c
          bestGain = gain
        }
      }
      tot[best] = (tot[best] as number) + ki
      if (best !== own) {
        comm[i] = best
        moved = true
      }
    })
  }

  const out = new Map<number, NodeId[]>()
  ids.forEach((id, i) => {
    const c = comm[i] as number
    out.set(c, [...(out.get(c) ?? []), id])
  })
  return [...out.values()]
}
