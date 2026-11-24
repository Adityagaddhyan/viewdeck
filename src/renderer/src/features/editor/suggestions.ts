/**
 * Builds autocomplete suggestions from the in-memory SchemaIndex: pure and
 * synchronous, so every keystroke is answered without IPC. It serves the SQL
 * editor (`sqlSuggestions`) and the table filter bar (`filterSuggestions`).
 * Editors map `kind` to their own icons (Monaco CompletionItemKind).
 */
import { SQL_KEYWORDS, quoteIfNeeded, type CompletionContext } from './completionContext'
import type { SchemaIndex } from './schemaIndex'

export type SuggestionKind = 'keyword' | 'schema' | 'table' | 'view' | 'column' | 'function' | 'operator'

export interface Suggestion {
  label: string
  kind: SuggestionKind
  detail?: string
  insertText: string
  /** Lower sorts first: columns (0) < tables (3) < schemas (5) < functions (7) < keywords (9). */
  sortText: string
}

/** Common Postgres functions offered in both editors. `$0` marks the cursor position. */
export const SQL_FUNCTIONS = [
  'now()', 'current_date', 'count(*)', 'coalesce($0)', 'lower($0)', 'upper($0)', 'length($0)', 'trim($0)',
  "date_trunc('day', $0)", 'extract(epoch from $0)', 'to_timestamp($0 / 1000)', 'to_char($0)', 'cast($0 as text)',
  'jsonb_extract_path_text($0)', 'jsonb_array_length($0)', 'jsonb_typeof($0)', 'array_length($0, 1)', 'any($0)',
  'string_agg($0, \', \')', 'array_agg($0)', 'sum($0)', 'avg($0)', 'min($0)', 'max($0)', 'gen_random_uuid()'
]

export const FILTER_OPERATORS = ['=', '<>', '>', '>=', '<', '<=', 'IN ()', 'NOT IN ()', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'BETWEEN', 'AND', 'OR', 'NOT', 'ASC', 'DESC', 'NULLS LAST']

const fn = (f: string): Suggestion => ({ label: f.replace('$0', '…'), kind: 'function', insertText: f, sortText: `7${f}` })

function columnItems(table: { name: string; columns: Array<{ name: string; dataType: string; ordinal: number }> }, showTable: boolean): Suggestion[] {
  return table.columns.map((c) => ({
    label: c.name,
    kind: 'column',
    detail: showTable ? `${table.name}.${c.name} · ${c.dataType}` : c.dataType,
    insertText: quoteIfNeeded(c.name),
    sortText: `0${String(c.ordinal).padStart(4, '0')}`
  }))
}

export function sqlSuggestions(ctx: CompletionContext, idx: SchemaIndex | null): Suggestion[] {
  const kw = SQL_KEYWORDS.map((k): Suggestion => ({ label: k, kind: 'keyword', insertText: k, sortText: `9${k}` }))
  if (!idx) return kw

  const columnsFor = (schema: string | null, table: string): Suggestion[] => {
    const t = idx.resolve(schema, table)
    return t ? columnItems(t, true) : []
  }

  if (ctx.kind === 'dotted') {
    // Precedence: alias → schema → table name. (`from billing.` parses as a ref to a
    // table named "billing", which must not shadow the schema.)
    const aliased = ctx.refs.find((r) => r.alias === ctx.qualifier)
    if (aliased) return columnsFor(aliased.schema, aliased.table)
    const schema = idx.schemaName(ctx.qualifier)
    const byTable = ctx.refs.find((r) => r.table === ctx.qualifier && idx.resolve(r.schema, r.table))
    if (byTable && !schema) return columnsFor(byTable.schema, byTable.table)
    if (schema) {
      return idx.tablesIn(schema).map((t) => ({ label: t.name, kind: t.kind === 'table' ? 'table' : 'view', detail: t.kind, insertText: quoteIfNeeded(t.name), sortText: `3${t.name}` }))
    }
    return columnsFor(null, ctx.qualifier) // `orders.` with no FROM yet
  }

  return [
    ...ctx.refs.flatMap((r) => columnsFor(r.schema, r.table)),
    ...idx.visibleTables().map((t): Suggestion => ({
      label: t.name,
      kind: t.kind === 'table' ? 'table' : 'view',
      detail: `${t.schema} · ${t.kind}`,
      insertText: quoteIfNeeded(t.name),
      sortText: `3${t.name}`
    })),
    ...idx.schemas.map((s): Suggestion => ({ label: s, kind: 'schema', detail: 'schema', insertText: quoteIfNeeded(s), sortText: `5${s}` })),
    ...SQL_FUNCTIONS.map(fn),
    ...kw
  ]
}

/** Suggestions for the table filter bar: this table's columns, operators, functions. */
export function filterSuggestions(columns: Array<{ name: string; dataType: string }>): Suggestion[] {
  return [
    ...columnItems({ name: '', columns: columns.map((c, i) => ({ ...c, ordinal: i + 1 })) }, false),
    ...FILTER_OPERATORS.map((o): Suggestion => ({ label: o, kind: 'operator', insertText: o, sortText: `8${o}` })),
    ...SQL_FUNCTIONS.map(fn),
    ...['TRUE', 'FALSE', 'NULL'].map((k): Suggestion => ({ label: k, kind: 'keyword', insertText: k, sortText: `9${k}` }))
  ]
}
