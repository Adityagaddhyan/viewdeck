import type { GraphTable, SchemaGraph } from '@shared/types/diagram'
import type { Cardinality, DiagramEdge, NodeId } from './graphModel'

/** Node id of a table: `${schema}.${table}`. Shared by the model, inference and join paths. */
export function tableId(t: { schema: string; name: string }): NodeId {
  return `${t.schema}.${t.name}`
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((c) => b.includes(c))

/**
 * Optionality and cardinality of a relationship, seen from the child table. A parent is
 * mandatory only when every referencing column is NOT NULL (a nullable column lets the row
 * exist without a parent). It is one-to-one when the referencing columns are themselves a
 * key of the child (PK or a unique key, compared as sets), because then at most one child
 * row can point at each parent. Missing column info (external stubs) counts as nullable.
 */
export function edgeShape(child: GraphTable, fromColumns: string[]): { required: boolean; cardinality: Cardinality } {
  const required = fromColumns.length > 0 && fromColumns.every((c) => child.columns.find((col) => col.name === c)?.nullable === false)
  const isKey = (child.primaryKey.length > 0 && sameSet(fromColumns, child.primaryKey)) || child.uniqueKeys.some((k) => sameSet(fromColumns, k))
  return { required, cardinality: isKey ? 'one-to-one' : 'many-to-one' }
}

const TYPE_ALIASES: Record<string, string> = {
  smallint: 'int2', smallserial: 'int2', serial2: 'int2',
  integer: 'int4', int: 'int4', serial: 'int4', serial4: 'int4',
  bigint: 'int8', bigserial: 'int8', serial8: 'int8',
  'character varying': 'varchar', character: 'bpchar', char: 'bpchar',
  decimal: 'numeric'
}
const FAMILY: Record<string, string> = {
  int2: 'int', int4: 'int', int8: 'int',
  text: 'text', varchar: 'text', bpchar: 'text', citext: 'text',
  uuid: 'uuid', numeric: 'numeric'
}

/** Canonical type name: lower-case, modifiers like `(255)` dropped, aliases folded (integer → int4). */
export function normalizeType(dataType: string): string {
  const t = dataType.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
  return TYPE_ALIASES[t] ?? t
}

/**
 * Whether a column of type `a` can plausibly reference a key of type `b`. Identical types
 * are high confidence; the same family (int4 → int8, varchar → text) or numeric ↔ integer
 * is medium, since joins work but the schema did not make the types match. Anything else
 * (text vs int, arrays) is rejected: a join on it would need a cast and is likely wrong.
 */
export function typeMatch(a: string, b: string): 'high' | 'medium' | null {
  const na = normalizeType(a)
  const nb = normalizeType(b)
  if (na === nb) return 'high'
  const fa = FAMILY[na]
  const fb = FAMILY[nb]
  if (fa === undefined || fb === undefined) return null
  if (fa === fb) return 'medium'
  if ((fa === 'numeric' && fb === 'int') || (fa === 'int' && fb === 'numeric')) return 'medium'
  return null
}

/**
 * The referenced-entity stem of a column name, or null when it does not look like a
 * reference. Only `<x>_id` (any case) and camelCase `<x>Id` qualify, so words that merely
 * end in "id" (`paid`, `valid`, `rfid`) never match. camelCase stems become snake_case.
 */
export function referenceStem(column: string): string | null {
  const snake = /^(.+)_id$/i.exec(column)
  if (snake?.[1]) return snake[1].toLowerCase()
  const camel = /^(.*[a-z0-9])Id$/.exec(column)
  if (camel?.[1]) return camel[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return null
}

/** Singular / plural spellings of a stem (x, xs, xes, y ⇄ ies), all lower-case. */
export function nameVariants(stem: string): string[] {
  const x = stem.toLowerCase()
  const out = new Set([x, `${x}s`, `${x}es`])
  if (x.endsWith('y')) out.add(`${x.slice(0, -1)}ies`)
  if (x.endsWith('ies')) out.add(`${x.slice(0, -3)}y`)
  if (x.endsWith('es')) out.add(x.slice(0, -2))
  if (x.endsWith('s')) out.add(x.slice(0, -1))
  return [...out]
}

const singlePk = (t: GraphTable): string | null => (t.primaryKey.length === 1 ? (t.primaryKey[0] ?? null) : null)

/** Picks the target table for a stem: same schema first, then other schemas in name order. */
function findTarget(byName: Map<string, GraphTable[]>, stem: string, source: GraphTable): GraphTable | null {
  const candidates = nameVariants(stem)
    .flatMap((v) => byName.get(v) ?? [])
    .filter((t) => t !== source && singlePk(t) !== null)
  candidates.sort((a, b) => Number(b.schema === source.schema) - Number(a.schema === source.schema) || tableId(a).localeCompare(tableId(b)))
  return candidates[0] ?? null
}

/** Self-reference stems: `parent` or `parent_<own table, singular or plural>`. */
function isSelfStem(stem: string, table: GraphTable): boolean {
  if (stem === 'parent') return true
  if (!stem.startsWith('parent_')) return false
  return nameVariants(stem.slice('parent_'.length)).includes(table.name.toLowerCase())
}

/**
 * Guesses relationships the schema does not declare, from naming conventions
 * (`customer_id` → `customers.id`). Many production schemas skip FK constraints, and
 * without this the diagram would show disconnected boxes. Guesses are conservative: the
 * target needs a single-column PK with a compatible type, columns already in a real FK
 * are skipped, and self-references only come from `parent_id`-style names (medium).
 * Output is sorted by source table, then column, so the diagram is stable across renders.
 */
export function inferRelationships(graph: SchemaGraph): DiagramEdge[] {
  const byName = new Map<string, GraphTable[]>()
  for (const t of graph.tables) {
    const key = t.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), t])
  }
  const fkColumns = new Set<string>()
  for (const fk of graph.foreignKeys) {
    for (const c of fk.fromColumns) fkColumns.add(`${fk.fromSchema}.${fk.fromTable}\u0000${c}`)
  }

  const edges: DiagramEdge[] = []
  for (const table of graph.tables) {
    if (table.external) continue
    const from = tableId(table)
    for (const col of table.columns) {
      if (fkColumns.has(`${from}\u0000${col.name}`)) continue
      const stem = referenceStem(col.name)
      if (stem === null) continue
      const self = isSelfStem(stem, table)
      const target = self ? (singlePk(table) !== null ? table : null) : findTarget(byName, stem, table)
      if (target === null) continue
      const pk = singlePk(target)
      if (pk === null || (self && pk === col.name)) continue
      const pkCol = target.columns.find((c) => c.name === pk)
      if (pkCol === undefined) continue
      const match = typeMatch(col.dataType, pkCol.dataType)
      if (match === null) continue
      const to = tableId(target)
      const a = normalizeType(col.dataType)
      const b = normalizeType(pkCol.dataType)
      const types = a === b ? `both ${a}` : `${a} vs ${b}`
      edges.push({
        id: `inf:${from}.${col.name}->${to}`,
        from,
        to,
        fromColumns: [col.name],
        toColumns: [pk],
        kind: 'inferred',
        ...edgeShape(table, [col.name]),
        onDelete: null,
        onUpdate: null,
        constraintName: null,
        selfReference: self,
        composite: false,
        confidence: self ? 'medium' : match,
        reason: self
          ? `column ${col.name} looks like a self-reference to ${target.name}.${pk} (${types})`
          : `column ${col.name} matches ${target.name}.${pk} (${types})`
      })
    }
  }
  return edges.sort((x, y) => x.from.localeCompare(y.from) || (x.fromColumns[0] ?? '').localeCompare(y.fromColumns[0] ?? ''))
}
