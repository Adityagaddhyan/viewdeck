/**
 * Output of a multi-statement run ("Run all"), shaped like a terminal session:
 * each statement's SQL followed by its result table, command tag or error.
 * Pure functions, unit-tested. Used by the All view and by "Copy all", so an
 * agent's batch of queries can be run once and pasted back in one click.
 */
import type { CellValue, QueryField, QueryResult } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { cellText, rowObjects, toMarkdown } from '../grid/copyFormats'

/** One executed statement of a script: exactly one of `result` / `error` is set. */
export interface ScriptStep {
  sql: string
  result: QueryResult | null
  error: AppError | null
}

export type ScriptFormat = 'markdown' | 'text' | 'json'

/** Display width (multi-line cells count their longest line). */
const width = (s: string): number => Math.max(0, ...s.split('\n').map((l) => [...l].length))
const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - [...s].length))
const oneLine = (v: CellValue): string => cellText(v).replace(/\r?\n/g, '\\n')

/** Column widths and one-line cell texts for an aligned table (shared by text output and the All view). */
export function alignedLayout(fields: QueryField[], rows: CellValue[][]): { widths: number[]; cells: string[][] } {
  const cells = rows.map((r) => fields.map((_, i) => oneLine(r[i] ?? null)))
  const widths = fields.map((f, i) => Math.max(width(f.name), ...cells.map((r) => width(r[i] ?? ''))))
  return { widths, cells }
}

/** Pads `text` with spaces to `w` characters (code points, so emoji count once). */
export const padCell = (text: string, w: number): string => pad(text, w)

/** `(1 row)` / `(N rows)` footer. */
export const rowsFooter = (n: number): string => `(${n} ${n === 1 ? 'row' : 'rows'})`

/**
 * psql-style aligned table: header, `---+---` rule, rows, `(N rows)` footer.
 * NULL prints as empty and newlines inside cells print as `\n`, so each row
 * stays on one line.
 */
export function toAligned(fields: QueryField[], rows: CellValue[][]): string {
  const { widths, cells } = alignedLayout(fields, rows)
  const line = (vals: string[]): string => ' ' + vals.map((v, i) => pad(v, widths[i] ?? 0)).join(' | ').trimEnd()
  return [line(fields.map((f) => f.name)), widths.map((w) => '-'.repeat(w + 2)).join('+'), ...cells.map(line), rowsFooter(rows.length)].join('\n')
}

/** `UPDATE 3`, `CREATE TABLE`: the summary for statements that return no columns. */
export function commandSummary(r: QueryResult): string {
  const cmd = r.command || 'OK'
  return /^(INSERT|UPDATE|DELETE|MERGE|COPY|MOVE|FETCH)$/i.test(cmd) ? `${cmd} ${r.rowCount}` : cmd
}

const truncNote = (r: QueryResult): string => `(truncated: only the first ${r.rows.length} rows were fetched)`

function stepBody(step: ScriptStep, table: (r: QueryResult) => string): string {
  if (step.error) return `ERROR: ${step.error.message}`
  const r = step.result
  if (!r) return '(not run)'
  if (r.fields.length === 0) return commandSummary(r)
  return r.truncated ? `${table(r)}\n${truncNote(r)}` : table(r)
}

/** Body text of one step as plain terminal output (what the All view shows). */
export const stepText = (step: ScriptStep): string => stepBody(step, (r) => toAligned(r.fields, r.rows))

/** All steps in one clipboard-ready string. */
export function formatScript(steps: ScriptStep[], format: ScriptFormat): string {
  if (format === 'json') {
    return JSON.stringify(
      steps.map((s) => ({
        sql: s.sql,
        command: s.result?.command ?? null,
        rowCount: s.result?.rowCount ?? null,
        rows: s.result && s.result.fields.length > 0 ? rowObjects(s.result.fields, s.result.rows) : null,
        truncated: s.result?.truncated ?? false,
        error: s.error?.message ?? null
      })),
      null,
      2
    )
  }
  if (format === 'markdown') {
    return steps
      .map((s) => {
        const body = stepBody(s, (r) => `${toMarkdown(r.fields, r.rows)}\n\n${rowsFooter(r.rows.length)}`)
        return `\`\`\`sql\n${s.sql}\n\`\`\`\n\n${body}`
      })
      .join('\n\n')
  }
  return steps.map((s) => `${s.sql.replace(/;?\s*$/, ';')}\n${stepText(s)}`).join('\n\n')
}
