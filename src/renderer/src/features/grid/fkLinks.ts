/**
 * Foreign-key navigation targets for a grid cell. Pure, unit-tested.
 * - outgoing: this column is (part of) an FK → open the referenced row.
 * - incoming: another table's FK references this column → show its rows.
 * Composite keys use every key column. NULL in any key part means no link.
 */
import type { CellValue, ForeignKeyInfo } from '@shared/types/driver'
import { sqlIdent, sqlLiteral } from './copyFormats'

export interface FkTarget {
  schema: string
  table: string
  where: string
  label: string
}

function whereFor(cols: string[], values: CellValue[]): string | null {
  if (values.some((v) => v === null || v === undefined)) return null
  return cols.map((c, i) => `${sqlIdent(c)} = ${sqlLiteral(values[i] ?? null)}`).join(' AND ')
}

export function outgoingTarget(column: string, row: Record<string, CellValue>, outgoing: ForeignKeyInfo[]): FkTarget | null {
  const fk = outgoing.find((f) => f.columns.includes(column))
  if (!fk) return null
  const where = whereFor(fk.refColumns, fk.columns.map((c) => row[c] ?? null))
  return where ? { schema: fk.refSchema, table: fk.refTable, where, label: `Open referenced row in ${fk.refTable}` } : null
}

export function incomingTargets(column: string, row: Record<string, CellValue>, incoming: ForeignKeyInfo[]): FkTarget[] {
  return incoming
    .filter((f) => f.refColumns.includes(column))
    .flatMap((f) => {
      const where = whereFor(f.columns, f.refColumns.map((c) => row[c] ?? null))
      return where ? [{ schema: f.schema, table: f.table, where, label: `Rows in ${f.schema}.${f.table} (${f.columns.join(', ')})` }] : []
    })
}
