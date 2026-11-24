/**
 * Catalog reads used by PostgresDriver (one function per DatabaseDriver
 * introspection method), plus result shaping. Each takes an already checked-out
 * client, so read-only / timeout syncing stays in the driver.
 */
import type pg from 'pg'
import type { CellValue, ColumnInfo, ForeignKeyInfo, QueryResult, SchemaInfo, TableInfo } from '@shared/types/driver'
import { FOREIGN_KEYS_SQL, LIST_SCHEMAS_SQL, LIST_TABLES_SQL, PRIMARY_KEYS_SQL, TABLE_COLUMNS_SQL } from './introspection'

/** Rows beyond this are dropped and the result is flagged `truncated`. */
export const MAX_RESULT_ROWS = 100_000

export async function listSchemas(c: pg.PoolClient): Promise<SchemaInfo[]> {
  return (await c.query<SchemaInfo>(LIST_SCHEMAS_SQL)).rows
}

export async function listTables(c: pg.PoolClient, schema: string): Promise<TableInfo[]> {
  const res = await c.query<{ name: string; kind: TableInfo['kind'] }>(LIST_TABLES_SQL, [schema])
  return res.rows.map((r) => ({ schema, name: r.name, kind: r.kind }))
}

export async function tableColumns(c: pg.PoolClient, schema: string, table: string): Promise<ColumnInfo[]> {
  const res = await c.query<{
    name: string
    data_type: string
    nullable: boolean
    default_value: string | null
    ordinal: number
    is_primary_key: boolean
    enum_values: string | null
  }>(
    TABLE_COLUMNS_SQL,
    [schema, table]
  )
  return res.rows.map((r) => ({
    name: r.name,
    dataType: r.data_type,
    nullable: r.nullable,
    defaultValue: r.default_value,
    ordinal: r.ordinal,
    isPrimaryKey: r.is_primary_key,
    enumValues: r.enum_values ? (JSON.parse(r.enum_values) as string[]) : null
  }))
}

export async function primaryKeys(c: pg.PoolClient, schema: string, table: string): Promise<string[]> {
  return (await c.query<{ name: string }>(PRIMARY_KEYS_SQL, [schema, table])).rows.map((r) => r.name)
}

export async function foreignKeys(c: pg.PoolClient, schema: string, table: string): Promise<{ outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] }> {
  const rows = (await c.query<{ name: string; schema: string; table: string; ref_schema: string; ref_table: string; cols: string; ref_cols: string }>(FOREIGN_KEYS_SQL, [schema, table])).rows
  const fks: ForeignKeyInfo[] = rows.map((r) => ({
    name: r.name,
    schema: r.schema,
    table: r.table,
    columns: JSON.parse(r.cols) as string[],
    refSchema: r.ref_schema,
    refTable: r.ref_table,
    refColumns: JSON.parse(r.ref_cols) as string[]
  }))
  return {
    outgoing: fks.filter((f) => f.schema === schema && f.table === table),
    incoming: fks.filter((f) => f.refSchema === schema && f.refTable === table)
  }
}

/** Shapes a row-mode result for IPC: type names via `typeName`, row cap applied. */
export function toQueryResult(res: pg.QueryArrayResult, durationMs: number, typeName: (oid: number) => string): QueryResult {
  const rows = (res.rows ?? []) as CellValue[][]
  return {
    fields: (res.fields ?? []).map((f) => ({ name: f.name, dataType: typeName(f.dataTypeID) })),
    rows: rows.length > MAX_RESULT_ROWS ? rows.slice(0, MAX_RESULT_ROWS) : rows,
    rowCount: res.rowCount ?? rows.length,
    command: res.command ?? '',
    durationMs,
    truncated: rows.length > MAX_RESULT_ROWS
  }
}
