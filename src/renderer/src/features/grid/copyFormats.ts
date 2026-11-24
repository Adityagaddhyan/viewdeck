/**
 * Clipboard formats for grid cells and rows (context menu + Cmd/Ctrl+C).
 * Pure functions, unit-tested. Conventions:
 * - NULL → empty in TSV/CSV/Markdown, `null` in JSON, `NULL` in SQL.
 * - json/jsonb columns are embedded as real JSON in "Copy as JSON".
 * - int8/numeric arrive as strings (exactness) and stay strings in JSON, while
 *   SQL output emits them unquoted when they are plain numbers.
 */
import type { CellValue, QueryField } from '@shared/types/driver'

export interface CopyTable {
  schema: string
  table: string
}

const isJsonType = (t: string): boolean => /^jsonb?$/i.test(t)
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/

/** Plain text for one cell (what Cmd+C on a cell copies). */
export function cellText(v: CellValue): string {
  if (v === null) return ''
  return typeof v === 'string' ? v : String(v)
}

function delimited(fields: QueryField[], rows: CellValue[][], sep: string, header: boolean): string {
  const esc = (s: string): string => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = rows.map((r) => r.map((v) => esc(cellText(v))).join(sep))
  if (header) lines.unshift(fields.map((f) => esc(f.name)).join(sep))
  return lines.join('\n')
}

/** Tab-separated (pastes into spreadsheets). Header row included when `header`. */
export const toTsv = (fields: QueryField[], rows: CellValue[][], header = false): string => delimited(fields, rows, '\t', header)
/** RFC 4180 CSV with a header row. */
export const toCsv = (fields: QueryField[], rows: CellValue[][]): string => delimited(fields, rows, ',', true)

function jsonValue(v: CellValue, field: QueryField | undefined): unknown {
  if (typeof v === 'string' && field && isJsonType(field.dataType)) {
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  return v
}

/** Rows as `{ column: value }` objects, with json/jsonb cells parsed into real JSON. */
export function rowObjects(fields: QueryField[], rows: CellValue[][]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f.name, jsonValue(r[i] ?? null, f)])))
}

/** One object per row. A single row is copied as an object, several as an array. */
export function toJson(fields: QueryField[], rows: CellValue[][]): string {
  const objs = rowObjects(fields, rows)
  return JSON.stringify(objs.length === 1 ? objs[0] : objs, null, 2)
}

const mdEscape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
export function toMarkdown(fields: QueryField[], rows: CellValue[][]): string {
  const head = `| ${fields.map((f) => mdEscape(f.name)).join(' | ')} |`
  const sep = `| ${fields.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map((v) => mdEscape(cellText(v))).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

export const sqlIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** SQL literal for a cell value. */
export function sqlLiteral(v: CellValue, dataType = ''): string {
  if (v === null) return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(v)
  if (NUMERIC_TEXT.test(v) && /^(int|numeric|decimal|float|real|double|oid|bigint|smallint)/i.test(dataType)) return v
  return `'${v.replace(/'/g, "''")}'`
}

/** One INSERT per row, with quoted identifiers and escaped literals. */
export function toInsert(target: CopyTable, fields: QueryField[], rows: CellValue[][]): string {
  const table = `${sqlIdent(target.schema)}.${sqlIdent(target.table)}`
  const cols = fields.map((f) => sqlIdent(f.name)).join(', ')
  return rows.map((r) => `INSERT INTO ${table} (${cols}) VALUES (${r.map((v, i) => sqlLiteral(v, fields[i]?.dataType)).join(', ')});`).join('\n')
}

/** `"col" = 'value'` or `"col" IS NULL`, ready for the filter bar or a WHERE clause. */
export function toWhere(field: QueryField, v: CellValue): string {
  return v === null ? `${sqlIdent(field.name)} IS NULL` : `${sqlIdent(field.name)} = ${sqlLiteral(v, field.dataType)}`
}

/** Parses a cell as JSON if it is a json/jsonb column, or text that is a JSON object/array. */
export function parseJsonCell(v: CellValue, dataType: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof v !== 'string') return { ok: false }
  const t = v.trim()
  if (!isJsonType(dataType) && !(/^[[{]/.test(t) && /[\]}]$/.test(t))) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch {
    return { ok: false }
  }
}
