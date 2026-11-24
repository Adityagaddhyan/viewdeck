/**
 * Bar above a query result grid:
 * - **Filter**: a SQL WHERE condition evaluated on the rows already loaded
 *   (`resultFilter.ts`), live as you type. An incomplete or invalid condition
 *   just shows every row (a muted "not applied", never an error). Nothing goes
 *   to the database.
 * - **Find** (⌘F): highlights cells containing the text; Enter / ⇧Enter jump
 *   to the next / previous match, Esc clears.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react'
import type { QueryField } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { cn } from '@renderer/lib/utils'
import { MiniSqlInput } from './MiniSqlInput'
import { filterSuggestions } from './suggestions'

export interface ResultToolbarHandle {
  focusFind: () => void
}

export interface ResultToolbarProps {
  fields: QueryField[]
  filter: string
  onFilter: (v: string) => void
  /** null = no filter typed; false = typed but not applied (incomplete / invalid). */
  filterApplied: boolean | null
  shown: number
  total: number
  find: string
  onFind: (v: string) => void
  matchCount: number
  /** 0-based index of the current match, or -1. */
  matchIndex: number
  onStep: (dir: 1 | -1) => void
}

export const ResultToolbar = forwardRef<ResultToolbarHandle, ResultToolbarProps>(function ResultToolbar(p, ref) {
  const findRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focusFind: () => (findRef.current?.focus(), findRef.current?.select()) }), [])
  const sample = p.fields.slice(0, 2).map((f) => f.name)
  const placeholder = sample.length ? `filter rows, e.g. ${sample[0]} = '…'${sample[1] ? ` and ${sample[1]} is not null` : ''}` : 'filter rows (SQL condition)'

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2" data-testid="result-toolbar">
      <Filter className={cn('size-3.5 shrink-0', p.filterApplied ? 'text-sky-500' : 'text-muted-foreground')} />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">WHERE</span>
      <div className="flex min-w-0 flex-[3]">
        <MiniSqlInput
          ariaLabel="Filter results"
          value={p.filter}
          onChange={p.onFilter}
          onSubmit={() => {}}
          onEscape={() => p.onFilter('')}
          onFind={() => findRef.current?.focus()}
          suggest={() => filterSuggestions(p.fields)}
          placeholder={placeholder}
        />
      </div>
      <span className={cn('shrink-0 text-[11px] tabular-nums', p.filterApplied ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground')} data-testid="filter-status">
        {p.filterApplied === null ? '' : p.filterApplied ? `${p.shown.toLocaleString()} of ${p.total.toLocaleString()} rows` : 'not applied'}
      </span>
      {p.filter && (
        <Button size="icon" variant="ghost" className="size-6" onClick={() => p.onFilter('')} title="Clear filter">
          <X />
        </Button>
      )}
      <div className="ml-1 flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-input bg-background px-1.5 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={findRef}
          aria-label="Find in results"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/70"
          placeholder={`Find (${MOD_LABEL}F)`}
          value={p.find}
          onChange={(e) => p.onFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              p.onStep(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              p.onFind('')
              findRef.current?.blur()
            }
          }}
        />
        {p.find && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" data-testid="find-status">
            {p.matchCount === 0 ? 'no matches' : `${p.matchIndex + 1}/${p.matchCount}`}
          </span>
        )}
        <button className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={!p.matchCount} onClick={() => p.onStep(-1)} title="Previous match (⇧Enter)" aria-label="Previous match">
          <ChevronUp className="size-3.5" />
        </button>
        <button className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={!p.matchCount} onClick={() => p.onStep(1)} title="Next match (Enter)" aria-label="Next match">
          <ChevronDown className="size-3.5" />
        </button>
      </div>
    </div>
  )
})
