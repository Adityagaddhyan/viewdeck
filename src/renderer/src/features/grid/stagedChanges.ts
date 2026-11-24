/**
 * Client-side staged edits for the table grid (ADR-003): nothing is written
 * until the user reviews the SQL diff and commits.
 *
 * Pure and immutable. Every function returns a new state, so React can diff it
 * and the logic is unit-tested without a DOM.
 *
 * Existing rows are addressed by their index in the loaded page. When a commit
 * is built, each staged row is identified by its ORIGINAL primary-key values,
 * so editing a PK column still targets the right row.
 */
import type { CellValue, QueryField, StagedChange, StagedChangeset } from '@shared/types/driver'

export interface StagedInsert {
  id: string
  values: Record<string, CellValue>
}

export interface StagedState {
  /** rowIndex → column → new value (only columns that differ from the original). */
  edits: Record<number, Record<string, CellValue>>
  deletes: number[]
  inserts: StagedInsert[]
}

export const emptyStaged: StagedState = { edits: {}, deletes: [], inserts: [] }

export function stageEdit(s: StagedState, rowIndex: number, column: string, value: CellValue, original: CellValue): StagedState {
  const rowEdits = { ...(s.edits[rowIndex] ?? {}) }
  if (value === original) delete rowEdits[column]
  else rowEdits[column] = value
  const edits = { ...s.edits }
  if (Object.keys(rowEdits).length === 0) delete edits[rowIndex]
  else edits[rowIndex] = rowEdits
  return { ...s, edits }
}

export function toggleDelete(s: StagedState, rowIndex: number): StagedState {
  return s.deletes.includes(rowIndex)
    ? { ...s, deletes: s.deletes.filter((i) => i !== rowIndex) }
    : { ...s, deletes: [...s.deletes, rowIndex] }
}

let insertSeq = 0
export function addInsert(s: StagedState): StagedState {
  return { ...s, inserts: [...s.inserts, { id: `new-${++insertSeq}`, values: {} }] }
}

export function editInsert(s: StagedState, id: string, column: string, value: CellValue): StagedState {
  return { ...s, inserts: s.inserts.map((r) => (r.id === id ? { ...r, values: { ...r.values, [column]: value } } : r)) }
}

export function removeInsert(s: StagedState, id: string): StagedState {
  return { ...s, inserts: s.inserts.filter((r) => r.id !== id) }
}

export function changeCount(s: StagedState): number {
  const editedRows = Object.keys(s.edits).filter((i) => !s.deletes.includes(Number(i))).length
  return editedRows + s.deletes.length + s.inserts.length
}

export interface ChangesetContext {
  schema: string
  table: string
  fields: QueryField[]
  rows: CellValue[][]
  primaryKey: string[]
}

/** Converts staged state into the engine-agnostic changeset sent to main. */
export function buildChangeset(s: StagedState, ctx: ChangesetContext): StagedChangeset {
  const colIndex = new Map(ctx.fields.map((f, i) => [f.name, i]))
  const keyOf = (rowIndex: number): Record<string, CellValue> => {
    if (ctx.primaryKey.length === 0) throw new Error(`${ctx.table} has no primary key, so rows can only be inserted.`)
    const row = ctx.rows[rowIndex] ?? []
    return Object.fromEntries(ctx.primaryKey.map((pk) => [pk, row[colIndex.get(pk) ?? -1] ?? null]))
  }

  const changes: StagedChange[] = []
  for (const [idx, values] of Object.entries(s.edits)) {
    const rowIndex = Number(idx)
    if (s.deletes.includes(rowIndex)) continue // A delete supersedes edits on the same row.
    changes.push({ kind: 'update', key: keyOf(rowIndex), values })
  }
  for (const ins of s.inserts) changes.push({ kind: 'insert', values: ins.values })
  for (const rowIndex of s.deletes) changes.push({ kind: 'delete', key: keyOf(rowIndex) })
  return { schema: ctx.schema, table: ctx.table, changes }
}

const NUMERIC = /^(int2|int4|int8|smallint|integer|bigint|float4|float8|real|double precision|numeric|decimal|oid)/i

/**
 * Interprets text typed into a cell editor. Ints and floats that are exactly
 * representable become numbers (int8/numeric stay strings, for precision),
 * bool text becomes boolean, and everything else stays a string that Postgres
 * casts by column type. NULL is set explicitly via the editor's NULL button,
 * never inferred from text.
 */
export function coerceInput(text: string, dataType: string): CellValue {
  if (/^bool/i.test(dataType)) {
    if (/^(t|true|1|yes|on)$/i.test(text.trim())) return true
    if (/^(f|false|0|no|off)$/i.test(text.trim())) return false
  }
  if (NUMERIC.test(dataType) && !/^(int8|bigint|numeric|decimal)/i.test(dataType)) {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) return n
  }
  return text
}
