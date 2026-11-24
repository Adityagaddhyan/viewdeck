/**
 * Web Worker: runs ELK (Eclipse Layout Kernel) off the UI thread, so laying out a
 * 300-table schema never freezes the app. Receives an ELK graph, posts back the
 * laid-out graph (or an error message).
 */
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api'

const elk = new ELK()

self.onmessage = async (e: MessageEvent<{ id: number; graph: ElkNode }>) => {
  const { id, graph } = e.data
  try {
    const result = await elk.layout(graph)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
