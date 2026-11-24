/**
 * Relationship line (React Flow custom edge) in crow's-foot notation, drawn from the
 * referenced (parent) table to the referencing (child) table:
 *   parent end: ‖ exactly one (required FK)  |  o| zero or one (nullable FK)
 *   child end:  crow's foot = many           |  | = one (one-to-one)
 * Line style: solid = declared foreign key, dashed amber = inferred from column names.
 * A red ✕ badge marks ON DELETE CASCADE. Self-references draw as a loop.
 * The SVG <marker>s live once in <RelationMarkers/>.
 */
import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { DiagramEdge } from './graphModel'

export type EdgeState = 'normal' | 'highlight' | 'path' | 'dim'
export interface RelationEdgeData extends Record<string, unknown> {
  edge: DiagramEdge
  state: EdgeState
}

type Variant = 'base' | 'hi' | 'path' | 'inf'
const COLORS: Record<Variant, string> = {
  base: 'var(--muted-foreground)',
  hi: 'rgb(14 165 233)',
  path: 'rgb(245 158 11)',
  inf: 'rgb(217 119 6)'
}

/** Marker shapes, drawn pointing at the table at x=24 (orient auto-start-reverse reuses them at the start). */
const SHAPES: Record<string, string> = {
  one: 'M14 5 V19 M19 5 V19', // ‖ exactly one
  zeroOne: 'M19 5 V19', // | plus a circle (below)
  many: 'M10 12 L24 4 M10 12 L24 20 M10 12 L24 12', // crow's foot
  oneChild: 'M18 5 V19' // | one
}

/** Defines every marker × colour once. Render inside the diagram, outside React Flow. */
export function RelationMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {(Object.keys(COLORS) as Variant[]).flatMap((v) =>
          Object.entries(SHAPES).map(([shape, d]) => (
            <marker key={`${shape}-${v}`} id={`vd-${shape}-${v}`} viewBox="0 0 24 24" refX="24" refY="12" markerWidth="18" markerHeight="18" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d={d} fill="none" stroke={COLORS[v]} strokeWidth="1.6" strokeLinecap="round" />
              {shape === 'zeroOne' && <circle cx="10" cy="12" r="4" fill="var(--background)" stroke={COLORS[v]} strokeWidth="1.6" />}
            </marker>
          ))
        )}
      </defs>
    </svg>
  )
}

export const RelationEdge = memo(function RelationEdge(props: EdgeProps & { data?: RelationEdgeData }) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  if (!data) return null
  const { edge, state } = data
  const variant: Variant = state === 'path' ? 'path' : state === 'highlight' ? 'hi' : edge.kind === 'inferred' ? 'inf' : 'base'
  let path: string
  let labelX: number
  let labelY: number
  if (edge.selfReference) {
    // Loop out of the right side and back into the card's top-right corner.
    path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${sourceY - 4}, ${sourceX + 70} ${sourceY - 70}, ${sourceX - 24} ${sourceY - 46}`
    labelX = sourceX + 52
    labelY = sourceY - 38
  } else {
    ;[path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 })
  }
  const parentMarker = edge.required ? 'one' : 'zeroOne'
  const childMarker = edge.cardinality === 'one-to-one' ? 'oneChild' : 'many'
  const strong = state === 'highlight' || state === 'path'
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={14}
        markerStart={`url(#vd-${parentMarker}-${variant})`}
        markerEnd={edge.selfReference ? undefined : `url(#vd-${childMarker}-${variant})`}
        style={{
          stroke: COLORS[variant],
          strokeWidth: strong ? 2.2 : 1.3,
          strokeDasharray: edge.kind === 'inferred' ? '5 4' : undefined,
          opacity: state === 'dim' ? 0.08 : 1,
          transition: 'opacity 120ms'
        }}
      />
      {edge.onDelete === 'CASCADE' && state !== 'dim' && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-red-500/60 bg-background px-1 text-[9px] font-semibold leading-[14px] text-red-600 dark:text-red-400"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {strong ? '✕ cascade' : '✕'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
