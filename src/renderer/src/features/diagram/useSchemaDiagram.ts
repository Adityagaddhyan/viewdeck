/**
 * Data side of the diagram tab: shows the cached graph + layout instantly, re-reads the
 * schema in the background (`db:getSchemaGraph`), rebuilds the model when the graph or
 * the inferred toggle changes, and recomputes the ELK layout only when the model's
 * structure changed (fingerprint). Dragged positions are saved with the layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SchemaGraph } from '@shared/types/diagram'
import type { AppError } from '@shared/types/result'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions, useAppState } from '@renderer/lib/store'
import { modelFingerprint, readDiagramCache, writeDiagramCache, type DiagramCacheEntry } from './diagramCache'
import { layoutDiagram, type DiagramLayout } from './diagramLayout'
import { buildDiagramModel, type DiagramModel } from './graphModel'

export interface LayoutState {
  fp: string
  layout: DiagramLayout
  moved: Record<string, { x: number; y: number }>
}

export function useSchemaDiagram(schema: string, active: boolean) {
  const session = useAppState((s) => s.session)
  const sessionId = session?.id ?? ''
  const connectionId = session?.connectionId ?? null
  const [graph, setGraph] = useState<SchemaGraph | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [inferred, setInferred] = useState(true)
  const [layout, setLayout] = useState<LayoutState | null>(null)
  const [layingOut, setLayingOut] = useState(false)
  const entry = useRef<DiagramCacheEntry | null>(null)
  const started = useRef(false)

  const persist = useCallback(
    (g: SchemaGraph, l: LayoutState | null) => {
      const next: DiagramCacheEntry = { v: 1, graph: g, ...(l ? { layout: { fingerprint: l.fp, layout: l.layout, moved: l.moved } } : entry.current?.layout ? { layout: entry.current.layout } : {}) }
      entry.current = next
      writeDiagramCache(connectionId, schema, next)
    },
    [connectionId, schema]
  )

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setRefreshing(true)
    try {
      const g = await call('db:getSchemaGraph', { sessionId, schema })
      setError(null)
      setGraph(g)
      persist(g, null)
    } catch (err) {
      const e = asAppError(err)
      if (entry.current) actions.showToast(`Couldn't refresh the diagram: ${e.message}`)
      else setError(e)
    } finally {
      setRefreshing(false)
    }
  }, [sessionId, schema, persist])

  // First activation: cached copy immediately, fresh read in the background.
  useEffect(() => {
    if (!active || started.current || !sessionId) return
    started.current = true
    void readDiagramCache(connectionId, schema).then((cached) => {
      if (cached) {
        entry.current = cached
        setGraph((g) => g ?? cached.graph)
      }
      void refresh()
    })
  }, [active, sessionId, connectionId, schema, refresh])

  const model: DiagramModel | null = useMemo(() => (graph ? buildDiagramModel(graph, { inferred }) : null), [graph, inferred])

  useEffect(() => {
    if (!model || !graph) return
    const fp = modelFingerprint(model)
    if (layout?.fp === fp) return
    const cached = entry.current?.layout
    if (cached?.fingerprint === fp) {
      setLayout({ fp, layout: cached.layout, moved: cached.moved })
      return
    }
    let cancelled = false
    setLayingOut(true)
    layoutDiagram(model)
      .then((l) => {
        if (cancelled) return
        const next = { fp, layout: l, moved: {} }
        setLayout(next)
        persist(graph, next)
      })
      .catch((err) => !cancelled && setError(asAppError(err)))
      .finally(() => !cancelled && setLayingOut(false))
    return () => {
      cancelled = true
    }
  }, [model]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Remembers a dragged card (position relative to its cluster box). */
  const saveMoved = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      setLayout((l) => {
        if (!l || !graph) return l
        const next = { ...l, moved: { ...l.moved, [id]: pos } }
        persist(graph, next)
        return next
      })
    },
    [graph, persist]
  )

  /** Forgets dragged positions and recomputes the layout. */
  const resetLayout = useCallback(() => {
    if (!model || !graph) return
    setLayingOut(true)
    void layoutDiagram(model)
      .then((l) => {
        const next = { fp: modelFingerprint(model), layout: l, moved: {} }
        setLayout(next)
        persist(graph, next)
      })
      .finally(() => setLayingOut(false))
  }, [model, graph, persist])

  return { graph, model, layout, layingOut, error, refreshing, refresh, inferred, setInferred, saveMoved, resetLayout }
}
