/**
 * Per connection + schema cache for the ER diagram, in prefs (LocalStore), so reopening
 * a diagram is instant: the last SchemaGraph, the ELK layout computed for it, and any
 * tables the user dragged. A fingerprint of the model's structure decides whether a
 * cached layout still applies; when the schema changes, the layout is recomputed and
 * dragged positions are dropped.
 */
import type { SchemaGraph } from '@shared/types/diagram'
import { call } from '@renderer/lib/ipc'
import type { DiagramLayout } from './diagramLayout'
import type { DiagramModel } from './graphModel'

export interface DiagramCacheEntry {
  v: 1
  graph: SchemaGraph
  layout?: { fingerprint: string; layout: DiagramLayout; moved: Record<string, { x: number; y: number }> }
}

const key = (connectionId: string, schema: string): string => `diagram:${connectionId}:${schema}`

/** Structure hash: nodes, edges and clusters (what positions depend on). Cheap FNV-1a. */
export function modelFingerprint(model: DiagramModel): string {
  const text = [
    model.nodes.map((n) => `${n.id}:${n.cluster}:${n.keyColumns.length}`).join('|'),
    model.edges.map((e) => e.id).join('|')
  ].join('#')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

export async function readDiagramCache(connectionId: string | null, schema: string): Promise<DiagramCacheEntry | null> {
  if (!connectionId) return null
  try {
    const v = (await call('prefs:get', { key: key(connectionId, schema) })) as DiagramCacheEntry | null
    return v && v.v === 1 && v.graph ? v : null
  } catch {
    return null
  }
}

export function writeDiagramCache(connectionId: string | null, schema: string, entry: DiagramCacheEntry): void {
  if (!connectionId) return
  void call('prefs:set', { key: key(connectionId, schema), value: entry }).catch(() => {})
}
