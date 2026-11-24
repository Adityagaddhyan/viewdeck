/**
 * Builds the SchemaSnapshot used for instant autocomplete: three catalog
 * queries on one connection (schemas, search_path, tables+columns), grouped into
 * the compact columnar shape.
 */
import type pg from 'pg'
import type { SchemaSnapshot, TableInfo } from '@shared/types/driver'
import { LIST_SCHEMAS_SQL, SEARCH_PATH_SQL, SNAPSHOT_MAX_ROWS, SNAPSHOT_SQL } from './introspection'

interface Row {
  schema: string
  name: string
  kind: TableInfo['kind']
  col: string | null
  type: string | null
  est: number | null
}

export async function loadSchemaSnapshot(c: pg.PoolClient): Promise<SchemaSnapshot> {
  const schemas = (await c.query<{ name: string }>(LIST_SCHEMAS_SQL)).rows.map((r) => r.name)
  const searchPath = (await c.query<{ name: string }>(SEARCH_PATH_SQL)).rows.map((r) => r.name)
  const rows = (await c.query<Row>(SNAPSHOT_SQL, [SNAPSHOT_MAX_ROWS])).rows

  const tables: SchemaSnapshot['tables'] = []
  let current: SchemaSnapshot['tables'][number] | undefined
  for (const r of rows) {
    if (!current || current.schema !== r.schema || current.name !== r.name) {
      current = { schema: r.schema, name: r.name, kind: r.kind, columns: [], rowEstimate: r.est === null || r.est < 0 ? null : Math.round(r.est) }
      tables.push(current)
    }
    if (r.col !== null) current.columns.push([r.col, r.type ?? ''])
  }
  return { schemas, searchPath, tables, truncated: rows.length >= SNAPSHOT_MAX_ROWS, takenAt: new Date().toISOString() }
}
