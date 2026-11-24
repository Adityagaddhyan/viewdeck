/**
 * Functions, sequences and user-defined types for the sidebar, plus their
 * definitions. Ids are OIDs as strings. Functions use Postgres's own
 * pg_get_functiondef. Sequences, enums and domains are reconstructed from the
 * catalog (there is no pg_get_*def for them).
 */
import type pg from 'pg'
import type { SchemaObjects } from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'
import { qualifiedTable, quoteIdent } from './changesetSql'
import { quoteLiteral } from './tableDdl'

const FUNCTIONS_SQL = `
SELECT p.oid::text AS id, p.proname AS name, pg_catalog.pg_get_function_identity_arguments(p.oid) AS signature,
       pg_catalog.pg_get_function_result(p.oid) AS returns,
       CASE p.prokind WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' ELSE 'function' END AS kind
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
ORDER BY p.proname, 3`

const SEQUENCES_SQL = `
SELECT c.oid::text AS id, c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind = 'S' ORDER BY c.relname`

const TYPES_SQL = `
SELECT t.oid::text AS id, t.typname AS name,
       CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' WHEN 'r' THEN 'range' ELSE 'composite' END AS kind
FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = $1 AND (t.typtype IN ('e', 'd', 'r') OR (t.typtype = 'c' AND (SELECT relkind FROM pg_catalog.pg_class WHERE oid = t.typrelid) = 'c'))
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
ORDER BY t.typname`

export async function listSchemaObjects(c: pg.PoolClient, schema: string): Promise<SchemaObjects> {
  const [f, s, t] = await Promise.all([c.query(FUNCTIONS_SQL, [schema]), c.query(SEQUENCES_SQL, [schema]), c.query(TYPES_SQL, [schema])])
  return { functions: f.rows, sequences: s.rows, types: t.rows } as SchemaObjects
}

const oid = (id: string): number => {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw new AppErrorException({ code: 'VALIDATION', message: 'Invalid object id' })
  return n
}

export async function objectDefinition(c: pg.PoolClient, kind: 'function' | 'sequence' | 'type', id: string): Promise<string> {
  const o = oid(id)
  if (kind === 'function') {
    const r = await c.query<{ def: string }>('SELECT pg_catalog.pg_get_functiondef($1::oid) AS def', [o])
    return r.rows[0]?.def ?? ''
  }
  if (kind === 'sequence') {
    const r = await c.query<{ schema: string; name: string; type: string; start: string; inc: string; min: string; max: string; cache: string; cycle: boolean }>(
      `SELECT n.nspname AS schema, c.relname AS name, pg_catalog.format_type(s.seqtypid, NULL) AS type, s.seqstart::text AS start, s.seqincrement::text AS inc,
              s.seqmin::text AS min, s.seqmax::text AS max, s.seqcache::text AS cache, s.seqcycle AS cycle
       FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE s.seqrelid = $1`,
      [o]
    )
    const q = r.rows[0]
    if (!q) return ''
    return `CREATE SEQUENCE ${qualifiedTable(q.schema, q.name)} AS ${q.type}\n  START ${q.start} INCREMENT ${q.inc}\n  MINVALUE ${q.min} MAXVALUE ${q.max}\n  CACHE ${q.cache}${q.cycle ? ' CYCLE' : ''};`
  }
  const r = await c.query<{ schema: string; name: string; typtype: string; labels: string | null; base: string | null; notnull: boolean; dflt: string | null; checks: string | null; cols: string | null }>(
    `SELECT n.nspname AS schema, t.typname AS name, t.typtype::text AS typtype,
            (SELECT array_to_json(array_agg(e.enumlabel ORDER BY e.enumsortorder))::text FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid) AS labels,
            CASE WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod) END AS base, t.typnotnull AS notnull, t.typdefault AS dflt,
            (SELECT array_to_json(array_agg(pg_catalog.pg_get_constraintdef(k.oid, true)))::text FROM pg_catalog.pg_constraint k WHERE k.contypid = t.oid) AS checks,
            (SELECT array_to_json(array_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum))::text
               FROM pg_catalog.pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS cols
     FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE t.oid = $1`,
    [o]
  )
  const t = r.rows[0]
  if (!t) return ''
  const name = `${quoteIdent(t.schema)}.${quoteIdent(t.name)}`
  if (t.typtype === 'e') return `CREATE TYPE ${name} AS ENUM (${(JSON.parse(t.labels ?? '[]') as string[]).map(quoteLiteral).join(', ')});`
  if (t.typtype === 'd') {
    const checks = (JSON.parse(t.checks ?? '[]') as string[]).map((x) => `\n  ${x}`).join('')
    return `CREATE DOMAIN ${name} AS ${t.base}${t.notnull ? ' NOT NULL' : ''}${t.dflt ? ` DEFAULT ${t.dflt}` : ''}${checks};`
  }
  if (t.typtype === 'c') return `CREATE TYPE ${name} AS (\n  ${(JSON.parse(t.cols ?? '[]') as string[]).join(',\n  ')}\n);`
  return `-- Range type ${name}: see pg_range for its subtype and functions.`
}
