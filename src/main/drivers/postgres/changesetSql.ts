/**
 * Turns a StagedChangeset into parameterised Postgres statements.
 *
 * This is the SQL shown in the diff preview AND the SQL that commitChanges
 * runs. They are produced by this one pure function (ADR-003).
 *
 * Safety rules:
 * - Values are ALWAYS bound parameters ($1, $2, …). Never interpolated.
 * - Identifiers are ALWAYS double-quoted with embedded quotes doubled, so mixed
 *   case, spaces and reserved words are safe.
 * - UPDATE and DELETE need a non-empty primary-key match and expect exactly 1
 *   affected row.
 * - Postgres infers each parameter's type from its column context
 *   (`SET col = $1`, `WHERE pk = $2`, `INSERT (col) VALUES ($3)`), so text-ish
 *   CellValues are cast server-side and we never need explicit casts.
 */
import type {
  CellValue,
  PreparedStatement,
  RowKey,
  StagedChange,
  StagedChangeset
} from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'

/** Quotes a Postgres identifier: `my"col` → `"my""col"`. */
export function quoteIdent(name: string): string {
  if (name.length === 0 || name.includes('\u0000')) {
    throw new AppErrorException({ code: 'VALIDATION', message: 'Invalid identifier' })
  }
  return `"${name.replace(/"/g, '""')}"`
}

export function qualifiedTable(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

class ParamList {
  readonly values: CellValue[] = []
  add(v: CellValue): string {
    this.values.push(v)
    return `$${this.values.length}`
  }
}

function whereKey(key: RowKey, params: ParamList): string {
  const cols = Object.keys(key)
  if (cols.length === 0) {
    throw new AppErrorException({
      code: 'VALIDATION',
      message: 'Cannot update or delete a row without a primary key.',
      hint: 'Tables without a primary key are insert-only in the grid.'
    })
  }
  return cols.map((c) => `${quoteIdent(c)} = ${params.add(key[c] ?? null)}`).join(' AND ')
}

function changeToStatement(table: string, change: StagedChange): PreparedStatement {
  const params = new ParamList()
  switch (change.kind) {
    case 'update': {
      const cols = Object.keys(change.values)
      if (cols.length === 0) {
        throw new AppErrorException({ code: 'VALIDATION', message: 'Update has no changed columns' })
      }
      const set = cols.map((c) => `${quoteIdent(c)} = ${params.add(change.values[c] ?? null)}`).join(', ')
      const where = whereKey(change.key, params)
      return { sql: `UPDATE ${table} SET ${set} WHERE ${where}`, params: params.values, expectRows: 1 }
    }
    case 'insert': {
      const cols = Object.keys(change.values)
      if (cols.length === 0) {
        return { sql: `INSERT INTO ${table} DEFAULT VALUES`, params: [], expectRows: 1 }
      }
      const names = cols.map(quoteIdent).join(', ')
      const placeholders = cols.map((c) => params.add(change.values[c] ?? null)).join(', ')
      return {
        sql: `INSERT INTO ${table} (${names}) VALUES (${placeholders})`,
        params: params.values,
        expectRows: 1
      }
    }
    case 'delete': {
      const where = whereKey(change.key, params)
      return { sql: `DELETE FROM ${table} WHERE ${where}`, params: params.values, expectRows: 1 }
    }
  }
}

/**
 * Builds statements in staging order, except that deletes run last, so an
 * update followed by a delete of the same row stays consistent.
 */
export function buildChangesetStatements(cs: StagedChangeset): PreparedStatement[] {
  const table = qualifiedTable(cs.schema, cs.table)
  const ordered = [
    ...cs.changes.filter((c) => c.kind !== 'delete'),
    ...cs.changes.filter((c) => c.kind === 'delete')
  ]
  return ordered.map((c) => changeToStatement(table, c))
}
