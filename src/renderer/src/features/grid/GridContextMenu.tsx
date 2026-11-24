/**
 * Right-click menu for the data grid (table browser and query results).
 * Cell / row targets: copy cell, copy rows as JSON / TSV / CSV / Markdown /
 * INSERT, copy as WHERE, view value, filter by value, edit / set NULL / delete
 * (when editable). Header targets: copy column name or values, sort.
 * Copy actions apply to every selected row when the clicked row is part of the
 * selection. Compare: two selected rows, or pin a row and compare another
 * (from any tab, table or result) with it.
 */
import { ArrowDownAZ, ArrowUpAZ, Braces, CalendarClock, ClipboardCopy, Eye, Filter, FilterX, GitCompare, Link2, Pencil, Pin, Trash2, X } from 'lucide-react'
import type { CellValue, QueryField } from '@shared/types/driver'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@renderer/components/ui/context-menu'
import { copyText } from '@renderer/lib/clipboard'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { actions as app, getState } from '@renderer/lib/store'
import type { RowSnapshot } from './compareRows'
import { cellText, toCsv, toInsert, toJson, toMarkdown, toTsv, toWhere, type CopyTable } from './copyFormats'
import { isIntegerType, type ColumnFormat } from './valueFormat'

export type MenuTarget = { kind: 'cell'; col: number; value: CellValue; rows: CellValue[][]; editable: boolean; links?: Array<{ label: string; run: () => void }> } | { kind: 'header'; col: number; columnValues: CellValue[] } | { kind: 'empty'; rows: CellValue[][] }

export interface GridMenuActions {
  table?: CopyTable
  onFilter?: (where: string) => void
  onSort?: (column: string, dir: 'asc' | 'desc') => void
  onDeleteSelected?: () => void
  /** Integer epoch columns: current format and a setter (null = raw). */
  formatOf?: (column: string) => ColumnFormat | undefined
  /** Foreign-key navigation targets for a cell (referenced row, referencing rows). */
  cellLinks?: (column: string, row: Record<string, CellValue>) => Array<{ label: string; label2?: string; run: () => void }>
  onSetFormat?: (column: string, fmt: ColumnFormat | null) => void
}

export function GridContextMenu({
  target,
  fields,
  actions,
  onView,
  onEdit,
  onSetNull
}: {
  target: MenuTarget | null
  fields: QueryField[]
  actions: GridMenuActions
  onView: () => void
  onEdit: () => void
  onSetNull: () => void
}) {
  if (!target) return <ContextMenuContent />
  const rowsCopy = (rows: CellValue[][]) => {
    const n = rows.length
    const what = n === 1 ? 'row' : `${n} rows`
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ClipboardCopy /> Copy {what} as…
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => void copyText(toJson(fields, rows), `Copied ${what} as JSON`)}>
            <Braces /> JSON
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(toTsv(fields, rows), `Copied ${what} as TSV`)}>TSV (spreadsheet)</ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(toTsv(fields, rows, true), `Copied ${what} as TSV with header`)}>TSV with header</ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(toCsv(fields, rows), `Copied ${what} as CSV`)}>CSV</ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(toMarkdown(fields, rows), `Copied ${what} as Markdown`)}>Markdown table</ContextMenuItem>
          {actions.table && (
            <ContextMenuItem onSelect={() => void copyText(toInsert(actions.table as CopyTable, fields, rows), `Copied ${what} as INSERT`)}>
              SQL INSERT
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  }

  if (target.kind === 'empty') {
    return <ContextMenuContent>{target.rows.length > 0 ? rowsCopy(target.rows) : <ContextMenuLabel>No rows</ContextMenuLabel>}</ContextMenuContent>
  }

  const field = fields[target.col]
  if (!field) return <ContextMenuContent />

  if (target.kind === 'header') {
    return (
      <ContextMenuContent>
        <ContextMenuLabel>
          {field.name} · {field.dataType}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={() => void copyText(field.name, 'Copied column name')}>
          <ClipboardCopy /> Copy column name
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(target.columnValues.map(cellText).join('\n'), `Copied ${target.columnValues.length} values`)}>
          Copy column values
        </ContextMenuItem>
        {actions.onSetFormat && isIntegerType(field.dataType) && (
          <>
            <ContextMenuSeparator />
            {(['epoch-ms', 'epoch-s'] as const).map((fmt) => (
              <ContextMenuItem key={fmt} onSelect={() => actions.onSetFormat?.(field.name, actions.formatOf?.(field.name) === fmt ? null : fmt)}>
                <CalendarClock /> {actions.formatOf?.(field.name) === fmt ? '✓ ' : ''}Format as date ({fmt === 'epoch-ms' ? 'epoch milliseconds' : 'epoch seconds'})
              </ContextMenuItem>
            ))}
            {actions.formatOf?.(field.name) && <ContextMenuItem onSelect={() => actions.onSetFormat?.(field.name, null)}>Show raw value</ContextMenuItem>}
          </>
        )}
        {actions.onSort && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => actions.onSort?.(field.name, 'asc')}>
              <ArrowUpAZ /> Sort ascending
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.onSort?.(field.name, 'desc')}>
              <ArrowDownAZ /> Sort descending
            </ContextMenuItem>
          </>
        )}
        {actions.onFilter && (
          <>
            <ContextMenuItem onSelect={() => actions.onFilter?.(`"${field.name.replace(/"/g, '""')}" IS NULL`)}>
              <Filter /> Filter: is NULL
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.onFilter?.(`"${field.name.replace(/"/g, '""')}" IS NOT NULL`)}>
              <FilterX /> Filter: is not NULL
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    )
  }

  const where = toWhere(field, target.value)
  const label = actions.table ? `${actions.table.schema}.${actions.table.table}` : (getState().tabs.find((t) => t.id === getState().activeTabId)?.title ?? 'result')
  const snap = (values: CellValue[] | undefined): RowSnapshot | null => (values ? { label, columns: fields.map((f) => f.name), values } : null)
  const first = snap(target.rows[0])
  const second = snap(target.rows[1])
  const pinned = getState().pinnedRow
  return (
    <ContextMenuContent>
      <ContextMenuLabel>
        {field.name} · {field.dataType}
      </ContextMenuLabel>
      <ContextMenuItem shortcut={`${MOD_LABEL}C`} onSelect={() => void copyText(cellText(target.value), 'Copied cell')}>
        <ClipboardCopy /> Copy cell
      </ContextMenuItem>
      {rowsCopy(target.rows)}
      <ContextMenuItem onSelect={() => void copyText(field.name, 'Copied column name')}>Copy column name</ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyText(where, 'Copied WHERE clause')}>Copy as WHERE clause</ContextMenuItem>
      <ContextMenuSeparator />
      {target.rows.length === 2 && first && second && (
        <ContextMenuItem onSelect={() => app.compareRows(first, second)}>
          <GitCompare /> Compare the 2 selected rows
        </ContextMenuItem>
      )}
      {pinned && first && (
        <ContextMenuItem onSelect={() => app.compareRows(pinned, first)}>
          <GitCompare /> Compare with pinned row ({pinned.label})
        </ContextMenuItem>
      )}
      {first && (
        <ContextMenuItem onSelect={() => app.pinRow(first)}>
          <Pin /> Pin row for comparison
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem shortcut="Space" onSelect={onView}>
        <Eye /> View value
      </ContextMenuItem>
      {target.links?.map((l) => (
        <ContextMenuItem key={l.label} onSelect={l.run}>
          <Link2 /> {l.label}
        </ContextMenuItem>
      ))}
      {actions.onFilter && (
        <ContextMenuItem onSelect={() => actions.onFilter?.(where)}>
          <Filter /> Filter by this value
        </ContextMenuItem>
      )}
      {target.editable && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem shortcut="↵" onSelect={onEdit}>
            <Pencil /> Edit cell
          </ContextMenuItem>
          <ContextMenuItem onSelect={onSetNull}>
            <X /> Set NULL
          </ContextMenuItem>
          {actions.onDeleteSelected && (
            <ContextMenuItem destructive onSelect={actions.onDeleteSelected}>
              <Trash2 /> Delete {target.rows.length === 1 ? 'row' : `${target.rows.length} rows`} (staged)
            </ContextMenuItem>
          )}
        </>
      )}
    </ContextMenuContent>
  )
}
