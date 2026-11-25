/**
 * Find bar for the cell inspector (ValueViewer): ⌘F focuses it, Enter / Shift+Enter
 * step through matches, Esc clears (a second Esc closes the panel). Plus `Highlight`,
 * which marks query occurrences inside a piece of text.
 */
import { forwardRef } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { splitMatches } from './valueSearch'

interface FindBarProps {
  query: string
  onQuery: (q: string) => void
  /** Index of the current match, and how many there are. */
  current: number
  total: number
  onStep: (delta: 1 | -1) => void
}

export const ValueFindBar = forwardRef<HTMLInputElement, FindBarProps>(function ValueFindBar({ query, onQuery, current, total, onStep }, ref) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          }
        }}
        placeholder="Find in value (⌘F)"
        aria-label="Find in value"
        spellCheck={false}
        className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
      {query !== '' && (
        <>
          <span className={cn('shrink-0 text-[11px] tabular-nums', total === 0 ? 'text-red-400' : 'text-muted-foreground')} data-testid="find-count">
            {total === 0 ? 'No matches' : `${current + 1} / ${total}`}
          </span>
          <IconButton label="Previous match" disabled={total === 0} onClick={() => onStep(-1)}>
            <ChevronUp className="size-3.5" />
          </IconButton>
          <IconButton label="Next match" disabled={total === 0} onClick={() => onStep(1)}>
            <ChevronDown className="size-3.5" />
          </IconButton>
          <IconButton label="Clear find" onClick={() => onQuery('')}>
            <X className="size-3.5" />
          </IconButton>
        </>
      )}
    </div>
  )
})

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
      {children}
    </button>
  )
}

/**
 * `text` with every occurrence of `query` marked. `current` (an occurrence index) gets
 * the strong colour and `data-current-match`, so the viewer can scroll it into view.
 */
export function Highlight({ text, query, current = null }: { text: string; query: string; current?: number | null }) {
  if (query === '') return <>{text}</>
  return (
    <>
      {splitMatches(text, query).map((s, i) =>
        s.match === null ? (
          s.text
        ) : (
          <mark
            key={i}
            data-current-match={s.match === current ? '' : undefined}
            className={cn('rounded-sm', s.match === current ? 'bg-amber-400/80 text-black' : 'bg-amber-300/40 text-inherit')}
          >
            {s.text}
          </mark>
        )
      )}
    </>
  )
}
