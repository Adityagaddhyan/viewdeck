/**
 * Column definitions and cell display for DataGrid: sortable header, display
 * text (NULL, booleans, epoch-as-date formatting) and hover tooltips
 * (local / UTC / relative for timestamps and formatted epochs).
 */
import { createColumnHelper } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { CellValue, QueryField } from '@shared/types/driver'
import { cn } from '@renderer/lib/utils'
import { describeInstant, epochToDate, formatLocal, formatUtc, isTemporalType, parsePgTimestamp, type ColumnFormat } from './valueFormat'

export interface GridRow {
  key: string
  values: CellValue[]
  /** Staged new values by column index (highlighted amber). */
  edited?: Record<number, CellValue>
  status?: 'inserted' | 'deleted'
}

const col = createColumnHelper<GridRow>()

export function buildColumns(
  fields: QueryField[],
  sort: { column: string; dir: 'asc' | 'desc' } | null | undefined,
  onSortClick: ((column: string) => void) | undefined,
  formats: Record<string, ColumnFormat> | undefined
) {
  return [
    col.display({ id: '__rownum', header: '', size: 48, enableResizing: false }),
    ...fields.map((f, i) =>
      col.accessor((r) => r.values[i] ?? null, {
        id: `c${i}`,
        header: () => (
          <button
            type="button"
            className={cn('flex min-w-0 flex-1 items-center gap-1 text-left leading-tight', !onSortClick && 'cursor-default')}
            onClick={() => onSortClick?.(f.name)}
            title={onSortClick ? 'Click to sort (asc → desc → off)' : undefined}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-foreground">{f.name}</span>
              <span className="truncate text-[10px] font-normal text-muted-foreground">
                {f.dataType}
                {formats?.[f.name] && <span className="text-sky-400"> · as date</span>}
              </span>
            </span>
            {sort?.column === f.name && (sort.dir === 'asc' ? <ArrowUp className="size-3 shrink-0 text-sky-400" /> : <ArrowDown className="size-3 shrink-0 text-sky-400" />)}
          </button>
        ),
        // Dates (formatted epochs, timestamps) get room for "YYYY-MM-DD hh:mm:ss.mmm".
        size: Math.min(320, Math.max(formats?.[f.name] || isTemporalType(f.dataType) ? 190 : 90, f.name.length * 8 + 40)),
        minSize: 50
      })
    )
  ]
}

export interface CellDisplay {
  text: string
  /** NULL styling. */
  muted: boolean
  /** Rendered from a format (epoch → date). */
  formatted: boolean
  title?: string
}

export function displayCell(v: CellValue, field: QueryField | undefined, fmt: ColumnFormat | undefined, utc = false): CellDisplay {
  if (v === null) return { text: 'NULL', muted: true, formatted: false }
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false', muted: false, formatted: false }
  const raw = String(v)
  if (fmt) {
    const d = epochToDate(v, fmt)
    if (d) return { text: utc ? formatUtc(d) : formatLocal(d), muted: false, formatted: true, title: `${raw} (${fmt === 'epoch-ms' ? 'epoch ms' : 'epoch s'})\n${describeInstant(d)}` }
  }
  const text = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw
  if (field && isTemporalType(field.dataType)) {
    const d = parsePgTimestamp(raw)
    if (d) return { text, muted: false, formatted: false, title: describeInstant(d) }
  }
  return { text, muted: false, formatted: false, title: raw.length > 40 ? text : undefined }
}
