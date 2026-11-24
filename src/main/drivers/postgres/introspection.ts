/**
 * Catalog queries for schema, table, column and PK introspection.
 *
 * Uses pg_catalog rather than information_schema: it is faster on large
 * catalogs, it includes materialized views (information_schema omits them),
 * and it does not hide objects the user lacks column privileges on.
 * All queries are parameterised. Names never get interpolated.
 */
export const LIST_SCHEMAS_SQL = `
SELECT n.nspname AS name
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\\_toast%'
  AND n.nspname NOT LIKE 'pg\\_temp\\_%'
ORDER BY (n.nspname = 'public') DESC, n.nspname`

export const LIST_TABLES_SQL = `
SELECT c.relname AS name,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized-view' ELSE 'table' END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND NOT c.relispartition
ORDER BY c.relname`

export const TABLE_COLUMNS_SQL = `
SELECT a.attname AS name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
       a.attnum AS ordinal,
       COALESCE(a.attnum = ANY (i.indkey), false) AS is_primary_key,
       (SELECT array_to_json(array_agg(e.enumlabel ORDER BY e.enumsortorder))::text
          FROM pg_catalog.pg_enum e WHERE e.enumtypid = a.atttypid) AS enum_values
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`

/** PK columns in key order. `indkey` is an int2vector, so unnest WITH ORDINALITY keeps the order. */
export const PRIMARY_KEYS_SQL = `
SELECT a.attname AS name
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, pos)
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary
ORDER BY k.pos`

/**
 * Whole catalog in one query: tables/views with their columns, in column order.
 * A LEFT JOIN keeps column-less tables. Capped (see SNAPSHOT_MAX_ROWS) so a huge
 * multi-tenant catalog can't stall the UI. Lazy per-table loads cover the rest.
 */
export const SNAPSHOT_SQL = `
SELECT n.nspname AS schema, c.relname AS name,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized-view' ELSE 'table' END AS kind,
       a.attname AS col, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, c.reltuples::float8 AS est
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
ORDER BY n.nspname, c.relname, a.attnum
LIMIT $1`

export const SNAPSHOT_MAX_ROWS = 250_000

/**
 * Foreign keys touching a table, in either direction, with column lists in key
 * order. Arrays are JSON text because our type parsers keep arrays as Postgres text.
 */
export const FOREIGN_KEYS_SQL = `
SELECT c.conname AS name, ns.nspname AS schema, cl.relname AS table, rn.nspname AS ref_schema, rc.relname AS ref_table,
       (SELECT array_to_json(array_agg(a.attname ORDER BY k.o))::text FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols,
       (SELECT array_to_json(array_agg(a.attname ORDER BY k.o))::text FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n) AS ref_cols
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
JOIN pg_catalog.pg_class rc ON rc.oid = c.confrelid JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
WHERE c.contype = 'f' AND ((ns.nspname = $1 AND cl.relname = $2) OR (rn.nspname = $1 AND rc.relname = $2))
ORDER BY c.conname`

export const SEARCH_PATH_SQL = `SELECT unnest(current_schemas(false)) AS name`

/** oid → type name, loaded once per connect so result columns show `timestamptz`, not `1184`. */
export const TYPE_NAMES_SQL = `SELECT oid::int AS oid, typname AS name FROM pg_catalog.pg_type`
