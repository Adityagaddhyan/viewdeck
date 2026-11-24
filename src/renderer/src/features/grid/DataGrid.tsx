/**
 * Virtualised data grid on TanStack Table v8 (columns, resizing) and TanStack
 * Virtual (rows). Only the visible rows plus overscan are in the DOM, so 100k
 * rows scroll smoothly.
 *
 * Interaction (shared by the table browser and query results):
 * - Click / arrows / Tab move a cell cursor. Shift and Cmd/Ctrl select rows
 *   (useGridSelection).
 * - Cmd/Ctrl+C copies the cell, or the selected rows as TSV. Right-click opens
 *   GridContextMenu.
 * - Space, or double-click on a JSON or read-only cell, opens ValueViewer.
 *   Enter or double-click on an editable cell edits inline (staged).
 * Staged-edit semantics live in TableTab / stagedChanges.ts. A GridRow carries
 * its display state (edited → amber, inserted → green, deleted → struck through).
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CellValue, ColumnInfo, QueryField } from '@shared/types/driver'
import { ArrowUpRight } from 'lucide-react'
import { ContextMenu, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { copyText } from '@renderer/lib/clipboard'
import { useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { CellEditor } from './CellEditor'
import { buildColumns, displayCell, type GridRow } from './gridColumns'
import type { ColumnFormat } from './valueFormat'
import { cellText, parseJsonCell, toTsv } from './copyFormats'
import { GridContextMenu, type GridMenuActions, type MenuTarget } from './GridContextMenu'
import { useGridSelection } from './useGridSelection'
import { ValueViewer, type ViewerTarget } from './ValueViewer'

export type { GridRow }

export interface DataGridProps {
  fields: QueryField[]
  rows: GridRow[]
  /** Called when an edit is committed (inline or from the viewer). Omit for a read-only grid. */
  onEditCell?: (row: GridRow, colIndex: number, value: CellValue) => void
  /** Whether a particular row/cell may be edited (e.g. no edits on deleted rows). */
  canEdit?: (row: GridRow, colIndex: number) => boolean
  /** Primary (most recently clicked) row, for toolbars that act on "the selected row". */
  onSelectRow?: (row: GridRow | null) => void
  /** Stage deletes for the given rows (context menu / Delete key). */
  onDeleteRows?: (rows: GridRow[]) => void
  /** Extra context-menu actions: INSERT target table, filter, sort. */
  menu?: Omit<GridMenuActions, 'onDeleteSelected'>
  /** Current sort (arrow in the header) and header-click handler. Omit for unsortable grids. */
  sort?: { column: string; dir: 'asc' | 'desc' } | null
  onSortClick?: (column: string) => void
  /** Per-column metadata (enum values, nullability) for type-aware editors. */
  columnMeta?: Record<string, ColumnInfo>
  /** Per-column display formats (integer epoch → date). */
  columnFormats?: Record<string, ColumnFormat>
  /** Columns that are (part of) an outgoing FK: cells get a hover ↗ to open the referenced row. */
  fkColumns?: Set<string>
  onFollowFk?: (column: string, row: Record<string, CellValue>) => void
  emptyText?: string
  /** Find in results: cells whose text contains this (lower-case) get highlighted. */
  highlight?: string
  /** Moves the cell cursor here (and scrolls to it); `n` changes to re-trigger the same cell. */
  focusCell?: { row: number; col: number; n: number } | null
}

const ROW_HEIGHT = 24

export const effectiveValues = (r: GridRow): CellValue[] =>
  r.values.map((v, i) => (r.edited && i in r.edited ? (r.edited[i] ?? null) : v))

export const DataGrid = memo(function DataGrid({ fields, rows, onEditCell, canEdit, onSelectRow, onDeleteRows, menu, sort, onSortClick, columnMeta, columnFormats, fkColumns, onFollowFk, emptyText, highlight, focusCell }: DataGridProps) {
  const utcDates = useAppState((s) => s.settings.dateDisplay === 'utc')
  const rowRecord = (r: GridRow): Record<string, CellValue> => Object.fromEntries(fields.map((f, i) => [f.name, effectiveValues(r)[i] ?? null]))
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const [target, setTarget] = useState<MenuTarget | null>(null)
  const sel = useGridSelection(rows.length, fields.length)

  // New data (page, filter, re-run) invalidates row indices.
  useEffect(() => sel.reset(), [rows.length, fields, sel.reset]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => void (focusCell && sel.setCursor({ row: focusCell.row, col: focusCell.col })), [focusCell]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => buildColumns(fields, sort, onSortClick, columnFormats), [fields, sort, onSortClick, columnFormats])

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), columnResizeMode: 'onChange', getRowId: (r) => r.key })
  const tableRows = table.getRowModel().rows
  const virtualizer = useVirtualizer({ count: tableRows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 20 })
  const totalWidth = table.getTotalSize()

  const isEditable = (ri: number, ci: number): boolean => {
    const r = rows[ri]
    return !!r && !!onEditCell && (canEdit?.(r, ci) ?? true)
  }
  const selectedRows = (around?: number): GridRow[] => {
    const idx = around !== undefined && !sel.selected.has(around) ? [around] : [...sel.selected].sort((a, b) => a - b)
    return idx.map((i) => rows[i]).filter((r): r is GridRow => !!r)
  }
  const openViewer = (ri: number, ci: number): void => {
    const r = rows[ri]
    const f = fields[ci]
    if (!r || !f) return
    setViewer({
      column: f.name,
      dataType: f.dataType,
      value: effectiveValues(r)[ci] ?? null,
      onSave: isEditable(ri, ci) ? (v) => onEditCell?.(r, ci, v) : undefined
    })
  }
  const activate = (ri: number, ci: number): void => {
    const r = rows[ri]
    const f = fields[ci]
    if (!r || !f) return
    const json = parseJsonCell(effectiveValues(r)[ci] ?? null, f.dataType).ok
    if (!json && isEditable(ri, ci)) setEditing({ row: ri, col: ci })
    else openViewer(ri, ci)
  }

  // Keep the cursor cell visible.
  useEffect(() => {
    if (!sel.cursor) return
    virtualizer.scrollToIndex(sel.cursor.row, { align: 'auto' })
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector(`[data-cell="${sel.cursor?.row}:${sel.cursor?.col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    )
  }, [sel.cursor]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (editing || viewer) return
    if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) return // Ctrl+Tab cycles workspace tabs (App)
    const mod = e.metaKey || e.ctrlKey
    const c = sel.cursor
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      const many = selectedRows()
      if (many.length > 1) void copyText(toTsv(fields, many.map(effectiveValues)), `Copied ${many.length} rows`)
      else if (c && rows[c.row]) void copyText(cellText(effectiveValues(rows[c.row] as GridRow)[c.col] ?? null), 'Copied cell')
      return
    }
    if (c && e.key === ' ') return (e.preventDefault(), openViewer(c.row, c.col))
    if (c && e.key === 'Enter') return (e.preventDefault(), activate(c.row, c.col))
    if ((e.key === 'Delete' || e.key === 'Backspace') && onDeleteRows && sel.selected.size > 0 && c && isEditable(c.row, c.col)) {
      e.preventDefault()
      onDeleteRows(selectedRows())
      return
    }
    if (sel.handleNavKey(e)) {
      e.preventDefault()
    }
  }
  useEffect(() => onSelectRow?.(sel.cursor ? (rows[sel.cursor.row] ?? null) : null), [sel.cursor?.row]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenuCapture={() => setTarget({ kind: 'empty', rows: rows.map(effectiveValues) })}
            className="relative h-full overflow-auto font-mono text-[12px] outline-none"
          >
            <div style={{ width: totalWidth, minWidth: '100%' }}>
              <div className="sticky top-0 z-20 flex border-b bg-card font-sans text-[11px]">
                {table.getHeaderGroups()[0]?.headers.map((h, hi) => (
                  <div
                    key={h.id}
                    className="relative flex h-8 shrink-0 items-center border-r px-1.5"
                    style={{ width: h.getSize() }}
                    onContextMenu={() => hi > 0 && setTarget({ kind: 'header', col: hi - 1, columnValues: rows.map((r) => effectiveValues(r)[hi - 1] ?? null) })}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getCanResize() && (
                      <div
                        onMouseDown={h.getResizeHandler()}
                        onDoubleClick={() => h.column.resetSize()}
                        className={cn('absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-sky-500/60', h.column.getIsResizing() && 'bg-sky-500')}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((vr) => {
                  const row = tableRows[vr.index]
                  if (!row) return null
                  const r = row.original
                  const ri = vr.index
                  const rowSelected = sel.selected.has(ri)
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        'absolute left-0 flex border-b border-border/50',
                        ri % 2 === 1 && 'bg-white/[0.015]',
                        rowSelected && 'bg-sky-500/10',
                        r.status === 'inserted' && 'bg-emerald-500/10',
                        r.status === 'deleted' && 'bg-red-500/10 text-muted-foreground line-through'
                      )}
                      style={{ transform: `translateY(${vr.start}px)`, height: ROW_HEIGHT, width: totalWidth }}
                    >
                      {row.getVisibleCells().map((cell, ci) => {
                        if (ci === 0) {
                          return (
                            <div
                              key={cell.id}
                              className="flex shrink-0 cursor-default items-center justify-end border-r px-1.5 text-[10px] text-muted-foreground/70"
                              style={{ width: cell.column.getSize() }}
                              onClick={(e) => sel.clickCell(ri, sel.cursor?.col ?? 0, e)}
                            >
                              {r.status === 'inserted' ? '+' : ri + 1}
                            </div>
                          )
                        }
                        const c = ci - 1
                        const isEdited = r.edited !== undefined && c in r.edited
                        const value = isEdited ? (r.edited?.[c] ?? null) : (r.values[c] ?? null)
                        const f = fields[c]
                        const { text, muted, formatted, title } = displayCell(value, f, f ? columnFormats?.[f.name] : undefined, utcDates)
                        const isCursor = sel.cursor?.row === ri && sel.cursor.col === c
                        const found = !!highlight && value !== null && String(value).toLowerCase().includes(highlight)
                        return (
                          <div
                            key={cell.id}
                            data-cell={`${ri}:${c}`}
                            className={cn(
                              'group/cell relative flex shrink-0 items-center overflow-hidden border-r border-border/50 px-1.5 whitespace-nowrap',
                              isEdited && 'bg-amber-500/20 text-amber-800 dark:text-amber-100',
                              muted && 'italic text-muted-foreground/60',
                              formatted && 'text-sky-700 dark:text-sky-200',
                              found && 'bg-yellow-300/50 dark:bg-yellow-500/30',
                              isCursor && 'outline outline-1 -outline-offset-1 outline-sky-400'
                            )}
                            style={{ width: cell.column.getSize() }}
                            title={title}
                            onClick={(e) => sel.clickCell(ri, c, e)}
                            onDoubleClick={() => activate(ri, c)}
                            onContextMenu={() => {
                              if (!sel.selected.has(ri)) sel.clickCell(ri, c, { metaKey: false, ctrlKey: false, shiftKey: false })
                              else sel.setCursor({ row: ri, col: c })
                              setTarget({
                                kind: 'cell',
                                col: c,
                                value,
                                rows: selectedRows(ri).map(effectiveValues),
                                editable: isEditable(ri, c),
                                links: f ? menu?.cellLinks?.(f.name, rowRecord(r)) : undefined
                              })
                            }}
                          >
                            <span className="truncate">{text}</span>
                            {f && value !== null && fkColumns?.has(f.name) && (
                              <button
                                className="absolute right-0.5 hidden rounded bg-background/90 px-0.5 text-sky-400 hover:bg-accent group-hover/cell:block"
                                title="Open referenced row"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onFollowFk?.(f.name, rowRecord(r))
                                }}
                              >
                                <ArrowUpRight className="size-3" />
                              </button>
                            )}
                            {editing?.row === ri && editing.col === c && (
                              <CellEditor
                                value={value}
                                dataType={f?.dataType ?? 'text'}
                                meta={f ? columnMeta?.[f.name] : undefined}
                                onCancel={() => (setEditing(null), scrollRef.current?.focus())}
                                onCommit={(v) => {
                                  setEditing(null)
                                  onEditCell?.(r, c, v)
                                  scrollRef.current?.focus()
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              {rows.length === 0 && <div className="p-6 text-center font-sans text-muted-foreground">{emptyText ?? 'No rows'}</div>}
            </div>
          </div>
        </ContextMenuTrigger>
        <GridContextMenu
          target={target}
          fields={fields}
          actions={{ ...menu, onDeleteSelected: onDeleteRows ? () => onDeleteRows(selectedRows()) : undefined }}
          onView={() => sel.cursor && openViewer(sel.cursor.row, sel.cursor.col)}
          onEdit={() => sel.cursor && setEditing({ row: sel.cursor.row, col: sel.cursor.col })}
          onSetNull={() => {
            const cur = sel.cursor
            const r = cur ? rows[cur.row] : undefined
            if (cur && r) onEditCell?.(r, cur.col, null)
          }}
        />
      </ContextMenu>
      <ValueViewer target={viewer} onClose={() => (setViewer(null), scrollRef.current?.focus())} />
    </>
  )
})
