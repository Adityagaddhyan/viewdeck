/**
 * Turns a DiagramModel into positions with ELK (in layout.worker.ts).
 *
 * Shape: each cluster is a compound node laid out left→right with the "layered"
 * algorithm (referenced/parent tables on the left, children on the right), and the
 * clusters themselves are packed with "rectpacking" so related tables sit together and
 * the whole schema fits a screen-ish rectangle. Edges between clusters don't influence
 * layout (React Flow still draws them). Card sizes come from `cardSize` so the layout
 * matches what TableNode renders.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { DiagramModel, DiagramNode, NodeId } from './graphModel'
import LayoutWorker from './layout.worker?worker'

export const CARD_WIDTH = 230
export const HEADER_H = 30
export const ROW_H = 18
/** Key columns shown on a card before "+N more". */
export const MAX_CARD_ROWS = 8

export const cardRows = (n: DiagramNode): number => Math.min(n.keyColumns.length, MAX_CARD_ROWS) + (n.keyColumns.length > MAX_CARD_ROWS ? 1 : 0)
export const cardSize = (n: DiagramNode): { width: number; height: number } => ({ width: CARD_WIDTH, height: HEADER_H + cardRows(n) * ROW_H + 6 })

export interface ClusterBox {
  id: number
  x: number
  y: number
  width: number
  height: number
}
export interface DiagramLayout {
  /** Node position relative to its cluster box. */
  nodes: Record<NodeId, { x: number; y: number; cluster: number }>
  clusters: ClusterBox[]
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (n: ElkNode) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new LayoutWorker()
  worker.onmessage = (e: MessageEvent<{ id: number; result?: ElkNode; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.result) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error ?? 'Layout failed'))
  }
  return worker
}

const runElk = (graph: ElkNode): Promise<ElkNode> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, graph })
  })

const PAD = 16
const CLUSTER_TOP = 34 // room for the cluster label

/** Lays out the model. Deterministic for the same model. */
export async function layoutDiagram(model: DiagramModel): Promise<DiagramLayout> {
  const clusterOf = new Map(model.nodes.map((n) => [n.id, n.cluster]))
  const children: ElkNode[] = model.clusters.map((c) => {
    const nodes = c.nodeIds.map((id) => ({ id, ...cardSize(model.byId.get(id)!) }))
    const edges: ElkExtendedEdge[] = model.edges
      .filter((e) => !e.selfReference && clusterOf.get(e.from) === c.id && clusterOf.get(e.to) === c.id)
      // Parent (referenced) → child, so parents land on the left.
      .map((e) => ({ id: e.id, sources: [e.to], targets: [e.from] }))
    const unconnected = edges.length === 0
    return {
      id: `cluster:${c.id}`,
      layoutOptions: {
        'elk.algorithm': unconnected ? 'rectpacking' : 'layered',
        'elk.direction': 'RIGHT',
        'elk.padding': `[top=${CLUSTER_TOP},left=${PAD},bottom=${PAD},right=${PAD}]`,
        'elk.spacing.nodeNode': '28',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.aspectRatio': '1.6'
      },
      children: nodes,
      edges
    }
  })
  const root: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'rectpacking', 'elk.spacing.nodeNode': '60', 'elk.aspectRatio': '1.8', 'elk.padding': '[top=20,left=20,bottom=20,right=20]' },
    children
  }
  const out = await runElk(root)
  const result: DiagramLayout = { nodes: {}, clusters: [] }
  for (const c of out.children ?? []) {
    const id = Number(c.id.slice('cluster:'.length))
    result.clusters.push({ id, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 })
    for (const n of c.children ?? []) result.nodes[n.id] = { x: n.x ?? 0, y: n.y ?? 0, cluster: id }
  }
  return result
}
