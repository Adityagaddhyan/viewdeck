/**
 * Reads everything the ER diagram needs for one schema in four catalog queries on one
 * connection: foreign keys touching the schema (both directions, so cross-schema links
 * show), the tables (the schema's own + external FK endpoints), their columns, and
 * their unique keys (PK + UNIQUE constraints/indexes, for one-to-one detection).
 *
 * Why pg_catalog and not information_schema: information_schema hides objects the role
 * can't access in odd ways and is much slower on large catalogs; pg_catalog also gives
 * us constraint column order (unnest WITH ORDINALITY) and reltuples/sizes in one pass.
 * Column lists come back as JSON text: the driver's type parsers keep PG arrays as raw
 * text (typeParsers.ts), so we parse them here explicitly.
 */
import type pg from 'pg'
import type { GraphColumn, GraphForeignKey, GraphTable, ReferentialAction, SchemaGraph } from '@shared/types/diagram'

/** A schema with more tables than this is cut off (the UI says so); keeps the payload bounded. */
export const GRAPH_MAX_TABLES = 3000

const ACTIONS: Record<string, ReferentialAction> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }
const KINDS: Record<string, GraphTable['kind']> = { r: 'table', v: 'view', m: 'materialized_view', p: 'partitioned_table', f: 'foreign_table' }

const FK_SQL = `
SELECT con.conname AS name,
       con.conrelid::int8 AS from_oid, fn.nspname AS from_schema, fc.relname AS from_table,
       con.confrelid::int8 AS to_oid, tn.nspname AS to_schema, tc.relname AS to_table,
       to_json(ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, o)
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.o))::text AS from_cols,
       to_json(ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, o)
             JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.o))::text AS to_cols,
       con.confdeltype AS on_delete, con.confupdtype AS on_update
FROM pg_constraint con
JOIN pg_class fc ON fc.oid = con.conrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
JOIN pg_class tc ON tc.oid = con.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
WHERE con.contype = 'f' AND (fn.nspname = $1 OR tn.nspname = $1) AND NOT fc.relispartition
ORDER BY fn.nspname, fc.relname, con.conname`

const TABLES_SQL = `
SELECT c.oid::int8 AS oid, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
       n.nspname <> $1 AS external,
       CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::float8 END AS est,
       CASE WHEN c.relkind IN ('r', 'm', 'p') THEN pg_total_relation_size(c.oid)::float8 END AS bytes,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ((n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'p', 'f') AND NOT c.relispartition) OR c.oid = ANY($2::oid[]))
ORDER BY n.nspname <> $1, c.relname
LIMIT ${GRAPH_MAX_TABLES}`

const COLUMNS_SQL = `
SELECT a.attrelid::int8 AS oid, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
       NOT a.attnotnull AS nullable, col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attrelid, a.attnum`

const UNIQUE_SQL = `
SELECT i.indrelid::int8 AS oid, i.indisprimary AS primary,
       to_json(ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n, o)
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.n ORDER BY k.o))::text AS cols
FROM pg_index i
WHERE i.indrelid = ANY($1::oid[]) AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
ORDER BY i.indrelid, i.indisprimary DESC, i.indexrelid`

interface FkRow {
  name: string
  from_oid: string
  from_schema: string
  from_table: string
  to_oid: string
  to_schema: string
  to_table: string
  from_cols: string
  to_cols: string
  on_delete: string
  on_update: string
}
interface TableRow {
  oid: string
  schema: string
  name: string
  kind: string
  external: boolean
  est: number | null
  bytes: number | null
  comment: string | null
}
interface ColumnRow {
  oid: string
  name: string
  type: string
  nullable: boolean
  comment: string | null
}
interface UniqueRow {
  oid: string
  primary: boolean
  cols: string
}

const names = (json: string): string[] => {
  const v: unknown = JSON.parse(json)
  return Array.isArray(v) ? v.map(String) : []
}

export async function loadSchemaGraph(c: pg.PoolClient, schema: string): Promise<SchemaGraph> {
  const fks = (await c.query<FkRow>(FK_SQL, [schema])).rows.map((f) => ({ ...f, fromCols: names(f.from_cols), toCols: names(f.to_cols) }))
  const endpointOids = [...new Set(fks.flatMap((f) => [f.from_oid, f.to_oid]))]
  const tableRows = (await c.query<TableRow>(TABLES_SQL, [schema, endpointOids])).rows
  const oids = tableRows.map((t) => t.oid)
  const columns = (await c.query<ColumnRow>(COLUMNS_SQL, [oids])).rows
  const uniques = (await c.query<UniqueRow>(UNIQUE_SQL, [oids])).rows.map((u) => ({ ...u, colList: names(u.cols) }))

  const colsBy = groupBy(columns, (r) => r.oid)
  const uniqBy = groupBy(uniques, (r) => r.oid)
  const present = new Set(oids)
  const foreignKeys: GraphForeignKey[] = fks
    .filter((f) => present.has(f.from_oid) && present.has(f.to_oid))
    .map((f) => ({
      name: f.name,
      fromSchema: f.from_schema,
      fromTable: f.from_table,
      fromColumns: f.fromCols,
      toSchema: f.to_schema,
      toTable: f.to_table,
      toColumns: f.toCols,
      onDelete: ACTIONS[f.on_delete] ?? 'NO ACTION',
      onUpdate: ACTIONS[f.on_update] ?? 'NO ACTION'
    }))
  // External stubs show only the columns that matter for the links.
  const fkColsBy = new Map<string, Set<string>>()
  for (const f of fks) {
    for (const [oid, cols] of [[f.from_oid, f.fromCols], [f.to_oid, f.toCols]] as const) {
      const set = fkColsBy.get(oid) ?? new Set<string>()
      cols.forEach((col) => set.add(col))
      fkColsBy.set(oid, set)
    }
  }

  const tables: GraphTable[] = tableRows.map((t) => {
    const keys = uniqBy.get(t.oid) ?? []
    const primaryKey = keys.find((k) => k.primary)?.colList ?? []
    let cols: GraphColumn[] = (colsBy.get(t.oid) ?? []).map((r) => ({ name: r.name, dataType: r.type, nullable: r.nullable, comment: r.comment }))
    if (t.external) {
      const keep = new Set([...primaryKey, ...(fkColsBy.get(t.oid) ?? [])])
      cols = cols.filter((col) => keep.has(col.name))
    }
    return {
      schema: t.schema,
      name: t.name,
      kind: KINDS[t.kind] ?? 'table',
      external: t.external,
      columns: cols,
      primaryKey,
      uniqueKeys: keys.filter((k) => !k.primary).map((k) => k.colList),
      rowEstimate: t.est === null ? null : Math.round(t.est),
      totalBytes: t.bytes,
      comment: t.comment
    }
  })
  return { schema, tables, foreignKeys, fetchedAt: new Date().toISOString() }
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}
