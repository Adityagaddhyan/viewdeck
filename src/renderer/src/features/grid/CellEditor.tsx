import { useEffect, useRef, useState } from 'react'
import type { CellValue, ColumnInfo } from '@shared/types/driver'
import { coerceInput } from './stagedChanges'
import { formatLocal } from './valueFormat'

/**
 * Inline cell editor, type-aware:
 * - enum columns → dropdown of the enum's labels (from pg_enum)
 * - bool → true / false dropdown
 * - date → native date picker
 * - timestamp / timestamptz → text with a "now" shortcut
 * - everything else → text
 * Enter or blur commits, Esc cancels. The ∅ button commits an explicit SQL
 * NULL, so typing the text "NULL" stays the string 'NULL'.
 */
export function CellEditor({
  value,
  dataType,
  meta,
  onCommit,
  onCancel
}: {
  value: CellValue
  dataType: string
  meta?: Pick<ColumnInfo, 'enumValues' | 'nullable'>
  onCommit: (v: CellValue) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const done = useRef(false)
  const isBool = /^bool/i.test(dataType)
  const enumValues = meta?.enumValues ?? null
  const isDate = /^date$/i.test(dataType)
  const isTs = /^timestamp/i.test(dataType)

  useEffect(() => {
    if (selectRef.current) selectRef.current.focus()
    else {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [])

  const commit = (v: CellValue): void => {
    if (done.current) return
    done.current = true
    onCommit(v)
  }
  const cancel = (): void => {
    done.current = true
    onCancel()
  }
  const onKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Enter') commit(isBool ? text === 'true' : enumValues ? text : coerceInput(text, dataType))
    if (e.key === 'Escape') cancel()
  }
  const box = 'h-full min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[12px] outline-none select-text'

  return (
    <div className="absolute inset-0 z-10 flex items-center bg-background ring-2 ring-amber-500">
      {isBool || enumValues ? (
        <select
          ref={selectRef}
          className={`${box} bg-background`}
          value={text}
          onChange={(e) => commit(isBool ? e.target.value === 'true' : e.target.value)}
          onKeyDown={onKey}
          onBlur={() => !done.current && cancel()}
        >
          {text === '' && <option value="">(choose)</option>}
          {(isBool ? ['true', 'false'] : (enumValues as string[])).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={inputRef}
          type={isDate ? 'date' : 'text'}
          className={box}
          value={isDate ? text.slice(0, 10) : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => commit(coerceInput(text, dataType))}
        />
      )}
      {isTs && (
        <button
          className="h-full shrink-0 px-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Set to now"
          onMouseDown={(e) => {
            e.preventDefault()
            commit(/tz|with time zone/i.test(dataType) ? new Date().toISOString() : formatLocal(new Date()))
          }}
        >
          now
        </button>
      )}
      <button
        className="h-full shrink-0 px-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Set NULL"
        onMouseDown={(e) => {
          e.preventDefault() // keep focus so blur doesn't commit the text first
          commit(null)
        }}
      >
        ∅
      </button>
    </div>
  )
}
