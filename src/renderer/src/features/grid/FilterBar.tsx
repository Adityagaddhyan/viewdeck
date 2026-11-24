/**
 * Sequel Pro / TablePlus-style filter bar for the table browser: a raw SQL
 * `WHERE` condition and an optional `ORDER BY`, with Postgres highlighting and
 * autocomplete (this table's columns with types, operators, functions) via
 * MiniSqlInput. Enter applies (or accepts a suggestion while the popup is open),
 * Esc clears. The driver contains the text (browseSql.ts). Read-only sessions
 * stay read-only, because the lock is enforced on the server.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Filter, X } from 'lucide-react'
import type { QueryField } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { cn } from '@renderer/lib/utils'
import { MiniSqlInput, type MiniSqlInputHandle } from '../editor/MiniSqlInput'
import { filterSuggestions } from '../editor/suggestions'

export interface TableFilter {
  where: string
  orderBy: string
}

export const EMPTY_FILTER: TableFilter = { where: '', orderBy: '' }

export interface FilterBarHandle {
  focus: () => void
}

export const FilterBar = forwardRef<
  FilterBarHandle,
  { applied: TableFilter; fields: QueryField[]; onApply: (f: TableFilter) => void; disabledReason?: string }
>(function FilterBar({ applied, fields, onApply, disabledReason }, ref) {
  const [draft, setDraft] = useState<TableFilter>(applied)
  const whereRef = useRef<MiniSqlInputHandle>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => setDraft(applied), [applied])
  useImperativeHandle(ref, () => ({ focus: () => whereRef.current?.focus() }), [])

  const dirty = draft.where !== applied.where || draft.orderBy !== applied.orderBy
  const active = applied.where.trim() !== '' || applied.orderBy.trim() !== ''
  const sample = fields.slice(1, 3).map((f) => f.name)
  const placeholder = sample.length ? `${sample[0]} = '…'${sample[1] ? ` and ${sample[1]} is not null` : ''}` : "status = 'OPEN'"
  const suggest = () => filterSuggestions(fields)
  const apply = (): void => onApply({ where: draftRef.current.where.trim(), orderBy: draftRef.current.orderBy.trim() })
  const clear = (): void => {
    setDraft(EMPTY_FILTER)
    if (active) onApply(EMPTY_FILTER)
  }

  return (
    <div className={cn('flex h-9 shrink-0 items-center gap-1.5 border-b px-2', active && 'bg-sky-500/5')} title={`Enter applies, Esc clears, ${MOD_LABEL}F focuses`}>
      <Filter className={cn('size-3.5 shrink-0', active ? 'text-sky-400' : 'text-muted-foreground')} />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">WHERE</span>
      <div className="flex min-w-0 flex-[3]">
        <MiniSqlInput
          ref={whereRef}
          ariaLabel="Filter WHERE condition"
          value={draft.where}
          onChange={(where) => setDraft((draftRef.current = { ...draftRef.current, where }))}
          onSubmit={apply}
          onEscape={clear}
          suggest={suggest}
          placeholder={placeholder}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">ORDER BY</span>
      <div className="flex min-w-0 flex-1">
        <MiniSqlInput
          ariaLabel="Filter ORDER BY"
          value={draft.orderBy}
          onChange={(orderBy) => setDraft((draftRef.current = { ...draftRef.current, orderBy }))}
          onSubmit={apply}
          onEscape={clear}
          onFind={() => whereRef.current?.focus()}
          suggest={suggest}
          placeholder="primary key"
        />
      </div>
      {disabledReason && dirty && <span className="shrink-0 text-[11px] text-amber-400">{disabledReason}</span>}
      <Button size="sm" variant={dirty ? 'default' : 'ghost'} onClick={apply} disabled={!dirty}>
        Apply <kbd className="text-[10px] opacity-70">↵</kbd>
      </Button>
      {active && (
        <Button size="icon" variant="ghost" onClick={() => onApply(EMPTY_FILTER)} title="Clear filter (Esc)">
          <X />
        </Button>
      )}
    </div>
  )
})
