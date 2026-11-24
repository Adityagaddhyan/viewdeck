/**
 * Works out what kind of completion the cursor wants. Pure, so it is tested.
 *
 *   `select * from sales.|`      → members of schema `sales` (tables)
 *   `select o.| from orders o`   → columns of the table aliased `o`
 *   `select | from orders`       → keywords + tables + columns of referenced tables
 *
 * Table references are found with a lightweight scan of FROM / JOIN / UPDATE /
 * INTO clauses, not a full parser. That is good enough for completion, and
 * wrong guesses only cost a suggestion.
 */
export interface TableRef {
  schema: string | null
  table: string
  alias: string | null
}

export type CompletionContext =
  | { kind: 'dotted'; qualifier: string; refs: TableRef[] }
  | { kind: 'general'; refs: TableRef[] }

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
const REF_RE = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+(${IDENT})(?:\s*\.\s*(${IDENT}))?(?:\s+(?:as\s+)?(${IDENT}))?`,
  'gi'
)
const NOT_ALIAS = new Set(['where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'on', 'group', 'order', 'limit', 'set', 'values', 'using', 'natural', 'lateral', 'returning', 'union', 'having', 'window', 'offset', 'for'])

/** `"My Table"` → `My Table`. Unquoted names fold to lower case, as in Postgres. */
export function normalizeIdent(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw.toLowerCase()
}

export function findTableRefs(statement: string): TableRef[] {
  const refs: TableRef[] = []
  for (const m of statement.matchAll(REF_RE)) {
    const [, first, second, aliasRaw] = m
    if (!first) continue
    const alias = aliasRaw && !NOT_ALIAS.has(aliasRaw.toLowerCase()) ? normalizeIdent(aliasRaw) : null
    refs.push(
      second
        ? { schema: normalizeIdent(first), table: normalizeIdent(second), alias }
        : { schema: null, table: normalizeIdent(first), alias }
    )
  }
  return refs
}

export function completionContext(textBeforeCursor: string, statement: string): CompletionContext {
  const refs = findTableRefs(statement)
  const dotted = new RegExp(`(${IDENT})\\s*\\.\\s*[A-Za-z0-9_$"]*$`).exec(textBeforeCursor)
  if (dotted?.[1]) return { kind: 'dotted', qualifier: normalizeIdent(dotted[1]), refs }
  return { kind: 'general', refs }
}

/** Quotes an identifier for insertion only if Postgres would need it. */
export function quoteIfNeeded(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN',
  'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'RETURNING', 'WITH', 'AS', 'DISTINCT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NOW()',
  'EXPLAIN', 'EXPLAIN ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'CREATE TABLE', 'ALTER TABLE',
  'DROP TABLE', 'TRUNCATE', 'UNION ALL', 'EXISTS', 'ASC', 'DESC', 'NULLS LAST', 'INTERVAL'
]
