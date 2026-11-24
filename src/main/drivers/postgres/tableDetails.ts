/**
 * Loads everything the table info panel shows, from pg_catalog and the
 * cumulative statistics views. All queries are read-only and parameterised by
 * the relation OID. The size functions and pg_stat_all_* work for any role
 * that can see the table, so read-only IAM users get the full panel.
 */
import type pg from 'pg'
import type { TableDetails } from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'
import { buildTableDdl, formatBytes, formatCount, type DdlColumn } from './tableDdl'

const REL_SQL = `
SELECT c.oid::int AS oid, c.relkind::text AS relkind, pg_get_userbyid(c.relowner) AS owner,
       obj_description(c.oid, 'pg_class') AS comment, c.reltuples::float8 AS est_rows,
       pg_total_relation_size(c.oid) AS total_bytes, pg_relation_size(c.oid) AS table_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0) AS toast_bytes,
       CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_def,
       CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS part_key,
       CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS part_bound,
       (SELECT i.inhparent::regclass::text FROM pg_inherits i WHERE i.inhrelid = c.oid LIMIT 1) AS parent
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`

const COLS_SQL = `
SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attidentity::text AS identity,
       a.attgenerated::text AS generated, col_description(a.attrelid, a.attnum) AS comment
FROM pg_catalog.pg_attribute a
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`

// contype 'n' = NOT NULL constraints (catalogued since PG18); rendered inline on columns instead.
const CONSTRAINTS_SQL = `
SELECT conname AS name, contype::text AS type, pg_get_constraintdef(oid, true) AS def
FROM pg_catalog.pg_constraint
WHERE conrelid = $1 AND contype <> 'n'
ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, conname`

const INDEXES_SQL = `
SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS is_unique,
       i.indisprimary AS is_primary, pg_relation_size(i.indexrelid) AS size_bytes, s.idx_scan AS scans,
       EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
               WHERE k.conindid = i.indexrelid AND k.conrelid = i.indrelid AND k.contype IN ('p', 'u', 'x')) AS backs_constraint
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
LEFT JOIN pg_catalog.pg_stat_all_indexes s ON s.indexrelid = i.indexrelid
WHERE i.indrelid = $1
ORDER BY i.indisprimary DESC, ic.relname`

const STATS_SQL = `
SELECT n_live_tup, n_dead_tup, seq_scan, idx_scan, n_tup_ins, n_tup_upd, n_tup_del,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_catalog.pg_stat_all_tables WHERE relid = $1`

const TRIGGERS_SQL = `
SELECT tgname AS name, pg_get_triggerdef(oid, true) AS def
FROM pg_catalog.pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname`

const REFERENCED_BY_SQL = `
SELECT conname AS name, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid, true) AS def
FROM pg_catalog.pg_constraint WHERE confrelid = $1 AND contype = 'f' ORDER BY 2, 1`

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const KIND: Record<string, TableDetails['kind']> = {
  r: 'table',
  p: 'partitioned-table',
  v: 'view',
  m: 'materialized-view',
  f: 'foreign-table'
}
const CONSTRAINT_LABEL: Record<string, string> = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check', x: 'exclusion', t: 'trigger' }

export async function loadTableDetails(c: pg.PoolClient, schema: string, table: string): Promise<TableDetails> {
  const rel = (await c.query<Row>(REL_SQL, [schema, table])).rows[0]
  if (!rel) throw new AppErrorException({ code: 'NOT_FOUND', message: `${schema}.${table} no longer exists.` })
  const oid = Number(rel['oid'])
  const [cols, cons, idx, stats, trg, refs] = await Promise.all([
    c.query<Row>(COLS_SQL, [oid]),
    c.query<Row>(CONSTRAINTS_SQL, [oid]),
    c.query<Row>(INDEXES_SQL, [oid]),
    c.query<Row>(STATS_SQL, [oid]),
    c.query<Row>(TRIGGERS_SQL, [oid]),
    c.query<Row>(REFERENCED_BY_SQL, [oid])
  ])

  const relkind = String(rel['relkind'])
  const columns: DdlColumn[] = cols.rows.map((r) => ({
    name: String(r['name']),
    type: String(r['type']),
    notNull: r['not_null'] === true,
    defaultExpr: str(r['default_expr']),
    identity: String(r['identity'] ?? ''),
    generated: String(r['generated'] ?? ''),
    comment: str(r['comment'])
  }))
  const parent = str(rel['parent'])
  const bound = str(rel['part_bound'])
  const ddl = buildTableDdl({
    schema,
    table,
    relkind,
    columns,
    constraints: cons.rows.map((r) => ({ name: String(r['name']), def: String(r['def']) })),
    standaloneIndexes: idx.rows.filter((r) => r['backs_constraint'] !== true).map((r) => String(r['def'])),
    triggers: trg.rows.map((r) => String(r['def'])),
    comment: str(rel['comment']),
    viewDef: str(rel['view_def']),
    partitionKey: str(rel['part_key']),
    partitionOf: parent && bound ? { parent, bound } : null
  })

  const s = stats.rows[0] ?? {}
  const est = num(rel['est_rows'])
  const live = num(s['n_live_tup'])
  const dead = num(s['n_dead_tup'])
  const when = (v: unknown): string => (v ? String(v).replace(/\.\d+/, '') : 'never')
  const deadPct = live && dead !== null && live + dead > 0 ? ` (${((dead / (live + dead)) * 100).toFixed(1)}%)` : ''

  return {
    kind: KIND[relkind] ?? 'table',
    owner: str(rel['owner']),
    comment: str(rel['comment']),
    ddl,
    stats: [
      { label: 'Estimated rows', value: est === null || est < 0 ? 'unknown' : formatCount(Math.round(est)), hint: 'pg_class.reltuples, updated by ANALYZE / VACUUM' },
      { label: 'Live rows', value: formatCount(live) },
      { label: 'Dead rows', value: `${formatCount(dead)}${deadPct}`, hint: 'Removed by VACUUM. A high share means bloat.' },
      { label: 'Total size', value: formatBytes(num(rel['total_bytes'])), hint: 'Table + indexes + TOAST' },
      { label: 'Table size', value: formatBytes(num(rel['table_bytes'])) },
      { label: 'Indexes size', value: formatBytes(num(rel['index_bytes'])) },
      { label: 'TOAST size', value: formatBytes(num(rel['toast_bytes'])), hint: 'Out-of-line storage for large values' },
      { label: 'Sequential scans', value: formatCount(num(s['seq_scan'])) },
      { label: 'Index scans', value: formatCount(num(s['idx_scan'])) },
      { label: 'Inserts / updates / deletes', value: `${formatCount(num(s['n_tup_ins']))} / ${formatCount(num(s['n_tup_upd']))} / ${formatCount(num(s['n_tup_del']))}`, hint: 'Since statistics were last reset' },
      { label: 'Last vacuum', value: when(s['last_vacuum']) },
      { label: 'Last autovacuum', value: when(s['last_autovacuum']) },
      { label: 'Last analyze', value: when(s['last_analyze']) },
      { label: 'Last autoanalyze', value: when(s['last_autoanalyze']) }
    ],
    indexes: idx.rows.map((r) => ({
      name: String(r['name']),
      definition: String(r['def']),
      unique: r['is_unique'] === true,
      primary: r['is_primary'] === true,
      sizeBytes: num(r['size_bytes']),
      scans: num(r['scans'])
    })),
    constraints: cons.rows.map((r) => ({ name: String(r['name']), type: CONSTRAINT_LABEL[String(r['type'])] ?? String(r['type']), definition: String(r['def']) })),
    referencedBy: refs.rows.map((r) => ({ name: String(r['name']), table: String(r['tbl']), definition: String(r['def']) })),
    triggers: trg.rows.map((r) => ({ name: String(r['name']), definition: String(r['def']) }))
  }
}
