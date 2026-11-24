/**
 * Builds the SELECT behind the table browser, including the user's optional
 * filter (`WHERE …`) and sort (`ORDER BY …`) from the grid's filter bar.
 *
 * The filter and sort are raw SQL fragments typed by the user. That is the
 * point of the feature (Sequel Pro / TablePlus style), and it grants no power
 * beyond the SQL editor. Guard rails:
 * - Each fragment sits on its own lines and the WHERE is parenthesised, so a
 *   trailing `-- comment` or a bare `OR` cannot swallow or bypass LIMIT/OFFSET.
 * - The query runs with bound parameters (extended protocol), so Postgres
 *   refuses a second statement smuggled after a `;`.
 * - Read-only is enforced on the server, and the caller rejects
 *   READ_WRITE_ESCAPE text while the session is locked.
 */
import { qualifiedTable, quoteIdent } from './changesetSql'

export interface BrowseSqlInput {
  schema: string
  table: string
  primaryKey: string[]
  where?: string
  orderBy?: string
}

/** Fragments longer than this are rejected. Filter bars are for short conditions. */
export const MAX_FILTER_LENGTH = 4000

/**
 * COUNT(*) with the same containment rules as buildBrowseSql. `LIMIT $1` (bind
 * 1) is deliberate: a bound parameter forces the extended protocol, which
 * rejects a smuggled second statement, exactly like the browse query.
 */
export function buildCountSql({ schema, table, where }: Pick<BrowseSqlInput, 'schema' | 'table' | 'where'>): string {
  const w = where?.trim()
  return `SELECT count(*)::text AS n FROM ${qualifiedTable(schema, table)}${w ? `\nWHERE (\n${w}\n)` : ''} LIMIT $1`
}

/** Planner estimate from pg_class (instant on any table size). */
export const ESTIMATE_SQL = `SELECT c.reltuples::float8 AS n FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`

export function buildBrowseSql({ schema, table, primaryKey, where, orderBy }: BrowseSqlInput): string {
  const w = where?.trim()
  const o = orderBy?.trim()
  // Default to PK order so paging is stable. A user ORDER BY replaces it.
  const order = o ? `\nORDER BY ${o}\n` : primaryKey.length ? ` ORDER BY ${primaryKey.map(quoteIdent).join(', ')}` : ''
  const filter = w ? `\nWHERE (\n${w}\n)` : ''
  return `SELECT * FROM ${qualifiedTable(schema, table)}${filter}${order} LIMIT $1 OFFSET $2`
}
