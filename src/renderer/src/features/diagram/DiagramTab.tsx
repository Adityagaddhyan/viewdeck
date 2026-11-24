/**
 * ER diagram tab for one schema (React Flow canvas + side panel).
 * - Clusters of related tables in coloured boxes; zoom out for the map, in for columns.
 * - Click a table: it and its neighbours light up, everything else dims (click again for
 *   2 hops, Esc or empty canvas clears). Double-click opens the table's data.
 * - Hover a table or a line for details; ⓘ explains the notation.
 * - "How are these related?" highlights the shortest join path and writes the SQL.
 * Data, cache and layout live in useSchemaDiagram.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Edge, type Node, type NodeChange, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Info, LayoutGrid, Maximize } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { useHotkey } from '@renderer/lib/hotkeys'
import { actions } from '@renderer/lib/store'
import { useIsDark } from '@renderer/lib/theme'
import { DiagramHover, type Hovered } from './DiagramHover'
import { DiagramLegend } from './DiagramLegend'
import { DiagramSidebar } from './DiagramSidebar'
import { findJoinPath, joinPathSql, neighborhood, type NodeId } from './graphModel'
import { RelationEdge, RelationMarkers, type EdgeState, type RelationEdgeData } from './RelationEdge'
import { ClusterNode, TableNode, type NodeState, type TableNodeData } from './TableNode'
import { useSchemaDiagram } from './useSchemaDiagram'

const nodeTypes = { table: TableNode, cluster: ClusterNode }
const edgeTypes = { relation: RelationEdge }
const clusterColor = (i: number, label?: string): string => (label === 'Unconnected' ? 'rgb(148 163 184)' : `hsl(${(i * 137.508 + 200) % 360} 62% 50%)`)

export function DiagramTab({ schema, active, focusRequest }: { schema: string; active: boolean; focusRequest?: { table: string; n: number } }) {
  const d = useSchemaDiagram(schema, active)
  const { model } = d
  const dark = useIsDark()
  const [nodes, setNodes] = useState<Node[]>([])
  const [focus, setFocus] = useState<{ id: NodeId; depth: number } | null>(null)
  const [ends, setEnds] = useState<{ from: NodeId | null; to: NodeId | null }>({ from: null, to: null })
  const [hovered, setHovered] = useState<Hovered | null>(null)
  const [legend, setLegend] = useState(false)
  const rf = useRef<ReactFlowInstance | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fitted = useRef<string | null>(null)

  const pathEdges = useMemo(() => (model && ends.from && ends.to ? findJoinPath(model, ends.from, ends.to) : null), [model, ends])
  const pathSql = useMemo(() => (model && ends.from && pathEdges ? joinPathSql(model, ends.from, pathEdges) : ''), [model, ends.from, pathEdges])
  const hasPath = !!(ends.from && ends.to && pathEdges)

  const { nodeState, edgeState } = useMemo(() => {
    const ns = new Map<NodeId, NodeState>()
    const es = new Map<string, EdgeState>()
    if (!model) return { nodeState: ns, edgeState: es }
    if (hasPath && pathEdges) {
      const onPath = new Set<NodeId>([ends.from!, ...pathEdges.flatMap((e) => [e.from, e.to])])
      const pathIds = new Set(pathEdges.map((e) => e.id))
      model.nodes.forEach((n) => ns.set(n.id, onPath.has(n.id) ? 'path' : 'dim'))
      model.edges.forEach((e) => es.set(e.id, pathIds.has(e.id) ? 'path' : 'dim'))
    } else if (focus && model.byId.has(focus.id)) {
      const near = neighborhood(model, focus.id, focus.depth)
      model.nodes.forEach((n) => ns.set(n.id, n.id === focus.id ? 'focus' : near.has(n.id) ? 'neighbor' : 'dim'))
      model.edges.forEach((e) => es.set(e.id, near.has(e.from) && near.has(e.to) ? 'highlight' : 'dim'))
    }
    return { nodeState: ns, edgeState: es }
  }, [model, focus, hasPath, pathEdges, ends.from])

  // Build nodes when the layout changes (positions come from the layout + dragged overrides).
  useEffect(() => {
    if (!model || !d.layout) return
    const { layout, moved } = d.layout
    const linkCols = new Map<NodeId, Set<string>>()
    for (const e of model.edges) {
      for (const [id, cols] of [[e.from, e.fromColumns], [e.to, e.toColumns]] as const) {
        const set = linkCols.get(id) ?? new Set<string>()
        cols.forEach((c) => set.add(c))
        linkCols.set(id, set)
      }
    }
    const groups: Node[] = layout.clusters.map((c) => {
      const cl = model.clusters[c.id]
      return { id: `cluster:${c.id}`, type: 'cluster', position: { x: c.x, y: c.y }, style: { width: c.width, height: c.height }, data: { label: cl?.label ?? '', size: cl?.size ?? 0, color: clusterColor(c.id, cl?.label), dim: false }, draggable: false, selectable: false, zIndex: -1 }
    })
    const tables: Node[] = model.nodes.flatMap((n) => {
      const pos = layout.nodes[n.id]
      if (!pos) return []
      const data: TableNodeData = { node: n, linkCols: linkCols.get(n.id) ?? new Set(), color: clusterColor(n.cluster, model.clusters[n.cluster]?.label), state: 'normal' }
      return [{ id: n.id, type: 'table', parentId: `cluster:${pos.cluster}`, position: moved[n.id] ?? { x: pos.x, y: pos.y }, data }]
    })
    setNodes([...groups, ...tables])
  }, [model, d.layout])

  // Apply focus / path state without touching positions.
  useEffect(() => {
    const anyState = nodeState.size > 0
    setNodes((ns) =>
      ns.map((n) => {
        if (n.type === 'table') {
          const s = nodeState.get(n.id) ?? 'normal'
          return (n.data as TableNodeData).state === s ? n : { ...n, data: { ...n.data, state: s } }
        }
        const dim = anyState && !ns.some((t) => t.parentId === n.id && (nodeState.get(t.id) ?? 'dim') !== 'dim')
        return n.data['dim'] === dim ? n : { ...n, data: { ...n.data, dim } }
      })
    )
  }, [nodeState, nodes.length])

  // Fit the whole diagram once per layout.
  useEffect(() => {
    if (!d.layout || !rf.current || nodes.length === 0 || fitted.current === d.layout.fp) return
    fitted.current = d.layout.fp
    requestAnimationFrame(() => rf.current?.fitView({ padding: 0.04, duration: 300 }))
  }, [d.layout, nodes.length])

  const edges: Edge[] = useMemo(
    () =>
      (model?.edges ?? []).map((e) => {
        const state = edgeState.get(e.id) ?? 'normal'
        const data: RelationEdgeData = { edge: e, state }
        return { id: e.id, source: e.to, target: e.from, type: 'relation', data, zIndex: state === 'highlight' || state === 'path' ? 5 : 0 }
      }),
    [model, edgeState]
  )

  const centerOn = useCallback((id: NodeId) => {
    const inst = rf.current
    const internal = inst?.getInternalNode(id)
    if (!inst || !internal) return
    const { x, y } = internal.internals.positionAbsolute
    inst.setCenter(x + (internal.measured.width ?? 230) / 2, y + (internal.measured.height ?? 80) / 2, { zoom: Math.max(inst.getZoom(), 0.9), duration: 350 })
  }, [])
  const focusTable = useCallback((id: NodeId) => {
    setFocus({ id, depth: 1 })
    centerOn(id)
  }, [centerOn])

  useEffect(() => {
    if (!focusRequest || !model || nodes.length === 0) return
    const id = `${schema}.${focusRequest.table}`
    if (model.byId.has(id)) requestAnimationFrame(() => focusTable(id))
  }, [focusRequest?.n, model, nodes.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  useHotkey('mod+f', () => searchRef.current?.focus(), active)
  useHotkey('escape', () => (setFocus(null), setEnds({ from: null, to: null }), setLegend(false)), active)

  const at = (e: React.MouseEvent): { x: number; y: number } => {
    const r = wrap.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }

  if (!model) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-[12px] text-muted-foreground">
        {d.error ? <ErrorBanner error={d.error} onRetry={() => void d.refresh()} /> : (<><Spinner /> Reading schema {schema}…</>)}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div ref={wrap} className="relative min-w-0 flex-1" data-testid="diagram-canvas">
        <RelationMarkers />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={dark ? 'dark' : 'light'}
          onInit={(inst) => (rf.current = inst)}
          onNodesChange={(changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns))}
          onNodeDragStop={(_, n) => n.type === 'table' && d.saveMoved(n.id, n.position)}
          onNodeClick={(_, n) => {
            if (n.type !== 'table') return
            setEnds({ from: null, to: null })
            setFocus((f) => (f?.id === n.id ? (f.depth === 1 ? { id: n.id, depth: 2 } : null) : { id: n.id, depth: 1 }))
          }}
          onNodeDoubleClick={(_, n) => {
            const t = n.type === 'table' ? (n.data as TableNodeData).node : null
            if (t) actions.openTable(t.schema, t.name)
          }}
          onPaneClick={() => setFocus(null)}
          onNodeMouseEnter={(e, n) => n.type === 'table' && setHovered({ kind: 'node', id: n.id, ...at(e) })}
          onNodeMouseMove={(e, n) => n.type === 'table' && setHovered({ kind: 'node', id: n.id, ...at(e) })}
          onNodeMouseLeave={() => setHovered(null)}
          onEdgeMouseEnter={(e, ed) => setHovered({ kind: 'edge', id: ed.id, ...at(e) })}
          onEdgeMouseMove={(e, ed) => setHovered({ kind: 'edge', id: ed.id, ...at(e) })}
          onEdgeMouseLeave={() => setHovered(null)}
          onlyRenderVisibleElements
          // Trackpad-native: pinch zooms, two-finger scroll pans; ⌘+scroll zooms with a mouse wheel.
          zoomOnPinch
          panOnScroll
          zoomActivationKeyCode="Meta"
          minZoom={0.04}
          maxZoom={2}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'table' ? String((n.data as TableNodeData).color) : 'transparent')} nodeStrokeWidth={0} maskColor={dark ? 'rgb(0 0 0 / 0.55)' : 'rgb(255 255 255 / 0.6)'} />
        </ReactFlow>
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border bg-card/90 px-1 py-0.5 shadow-sm backdrop-blur">
          <Button size="sm" variant={legend ? 'secondary' : 'ghost'} className="h-6" onClick={() => setLegend((v) => !v)} aria-label="Legend" title="What do the lines mean?">
            <Info /> Legend
          </Button>
          <Button size="sm" variant="ghost" className="h-6" onClick={() => rf.current?.fitView({ padding: 0.04, duration: 300 })} title="Fit the whole diagram">
            <Maximize /> Fit
          </Button>
          <Button size="sm" variant="ghost" className="h-6" onClick={d.resetLayout} title="Recompute the layout (forgets dragged positions)">
            <LayoutGrid /> Re-layout
          </Button>
          {(d.layingOut || d.refreshing) && <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"><Spinner /> {d.layingOut ? `Laying out ${model.nodes.length} tables…` : 'Refreshing…'}</span>}
          {focus && <span className="px-1 text-[11px] text-muted-foreground">Focus: {model.byId.get(focus.id)?.name} · {focus.depth} hop{focus.depth > 1 ? 's' : ''} · Esc clears</span>}
        </div>
        {legend && <DiagramLegend onClose={() => setLegend(false)} />}
        {hovered && <DiagramHover hovered={hovered} model={model} bounds={wrap.current?.getBoundingClientRect() ?? null} />}
      </div>
      <DiagramSidebar
        model={model}
        focusId={focus?.id ?? null}
        onFocus={focusTable}
        onFitCluster={(id) => {
          const box = d.layout?.layout.clusters.find((c) => c.id === id)
          if (box) rf.current?.fitBounds(box, { padding: 0.08, duration: 400 })
        }}
        clusterColor={(id) => clusterColor(id, model.clusters[id]?.label)}
        inferred={d.inferred}
        setInferred={d.setInferred}
        path={{ from: ends.from, to: ends.to, edges: pathEdges, sql: pathSql }}
        setPathEnd={(end, id) => {
          setFocus(null)
          setEnds((e) => ({ ...e, [end]: id }))
        }}
        onRunSql={(sql) => actions.newQueryTab(sql)}
        fetchedAt={d.graph?.fetchedAt ?? null}
        refreshing={d.refreshing}
        onRefresh={() => void d.refresh()}
        searchRef={searchRef}
      />
    </div>
  )
}
