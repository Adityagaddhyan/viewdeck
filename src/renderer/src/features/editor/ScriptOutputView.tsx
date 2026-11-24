/**
 * "All" view of a multi-statement run: every statement's SQL followed by its
 * psql-style output, error or command tag, in one selectable monospace panel
 * (like scrolling back through a terminal). Timestamp cells show local / UTC /
 * relative time on hover, like the grid. Also exports the "Copy all" menu.
 */
import { Fragment } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import type { QueryField } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { copyText } from '@renderer/lib/clipboard'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions } from '@renderer/lib/store'
import { describeInstant, isTemporalType, parsePgTimestamp } from '../grid/valueFormat'
import { alignedLayout, commandSummary, formatScript, padCell, rowsFooter, stepText, type ScriptFormat, type ScriptStep } from './scriptOutput'

/** Rows rendered per statement. Copy all still includes every fetched row. */
const VIEW_ROWS = 200

const FORMATS: Array<{ format: ScriptFormat; label: string; ext: string }> = [
  { format: 'markdown', label: 'Markdown (for chats and docs)', ext: 'md' },
  { format: 'text', label: 'Plain text (terminal style)', ext: 'txt' },
  { format: 'json', label: 'JSON', ext: 'json' }
]

/** Hover text for a timestamp-typed cell, else undefined. */
function cellTitle(field: QueryField | undefined, text: string): string | undefined {
  if (!field || !text || !isTemporalType(field.dataType)) return undefined
  const d = parsePgTimestamp(text)
  return d ? describeInstant(d) : undefined
}

function ResultTable({ step }: { step: ScriptStep }) {
  const r = step.result
  if (!r || r.fields.length === 0) return null
  const shown = r.rows.slice(0, VIEW_ROWS)
  const { widths, cells } = alignedLayout(r.fields, shown)
  const row = (vals: string[], header: boolean) => (
    <div>
      {' '}
      {vals.map((v, i) => (
        <Fragment key={i}>
          {i > 0 && ' | '}
          <span title={header ? r.fields[i]?.dataType : cellTitle(r.fields[i], v)} className={header ? 'font-semibold text-foreground' : undefined}>
            {padCell(v, widths[i] ?? 0)}
          </span>
        </Fragment>
      ))}
    </div>
  )
  return (
    <>
      {row(r.fields.map((f) => f.name), true)}
      <div>{widths.map((w) => '-'.repeat(w + 2)).join('+')}</div>
      {cells.map((c, i) => (
        <Fragment key={i}>{row(c, false)}</Fragment>
      ))}
      <div className="text-muted-foreground">
        {rowsFooter(r.rows.length)}
        {r.rows.length > VIEW_ROWS && ` · showing ${VIEW_ROWS}, +${(r.rows.length - VIEW_ROWS).toLocaleString()} more rows (included in Copy all)`}
        {r.truncated && ' · truncated by the row limit'}
      </div>
    </>
  )
}

export function ScriptOutputView({ steps }: { steps: ScriptStep[] }) {
  return (
    <div className="h-full overflow-auto p-2 font-mono text-[12px] leading-[1.45] whitespace-pre select-text" data-testid="script-output">
      {steps.map((s, i) => (
        <div key={i} className="group mb-4">
          <div className="flex items-start gap-2 text-sky-600 dark:text-sky-400">
            <span className="select-none text-muted-foreground">{i + 1}&gt;</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{s.sql}</span>
            <button
              className="select-none opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
              title="Copy this statement and its result"
              onClick={() => void copyText(formatScript([s], 'markdown'), 'Copied result')}
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          {s.error ? (
            <div className="whitespace-pre-wrap text-red-500">ERROR: {s.error.message}</div>
          ) : s.result && s.result.fields.length > 0 ? (
            <ResultTable step={s} />
          ) : (
            <div className="text-muted-foreground">{s.result ? commandSummary(s.result) : stepText(s)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

/** "Copy all" (Markdown in one click) plus a menu for other formats and saving to a file. */
export function CopyAllMenu({ steps }: { steps: ScriptStep[] }) {
  const save = async (format: ScriptFormat, ext: string): Promise<void> => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    try {
      const { path } = await call('app:saveFile', { defaultName: `results-${stamp}.${ext}`, content: formatScript(steps, format) })
      if (path) actions.showToast(`Saved ${path.split('/').pop()}`)
    } catch (e) {
      actions.showToast(`Save failed: ${asAppError(e).message}`)
    }
  }
  const label = `Copied ${steps.length} results`
  return (
    <div className="ml-auto flex items-center">
      <Button size="sm" variant="ghost" className="h-6 rounded-r-none pr-1.5" onClick={() => void copyText(formatScript(steps, 'markdown'), label)} title="Copy every query with its result (Markdown)">
        <Copy /> Copy all
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 rounded-l-none px-1" aria-label="Copy all options">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Copy all {steps.length} results as</DropdownMenuLabel>
          {FORMATS.map((f) => (
            <DropdownMenuItem key={f.format} onSelect={() => void copyText(formatScript(steps, f.format), label)}>
              {f.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {FORMATS.map((f) => (
            <DropdownMenuItem key={f.ext} onSelect={() => void save(f.format, f.ext)}>
              Save all as .{f.ext}…
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
