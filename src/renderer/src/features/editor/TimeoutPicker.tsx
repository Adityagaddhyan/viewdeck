/** Session-wide statement timeout picker for the query toolbar (db:setStatementTimeout). */
import { Timer } from 'lucide-react'
import { call } from '@renderer/lib/ipc'
import { actions, useAppState } from '@renderer/lib/store'

const OPTIONS: Array<[ms: number, label: string]> = [
  [0, 'Off'],
  [5_000, '5s'],
  [30_000, '30s'],
  [60_000, '1m'],
  [300_000, '5m'],
  [900_000, '15m']
]

export function formatTimeout(ms: number): string {
  return OPTIONS.find(([v]) => v === ms)?.[1] ?? (ms === 0 ? 'Off' : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1000)}s`)
}

export function TimeoutPicker() {
  const session = useAppState((s) => s.session)
  if (!session) return null
  const value = session.statementTimeoutMs
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Statement timeout for this session (server-enforced). Defaults: prod 30s, staging 1m, dev off.">
      <Timer className="size-3.5" />
      <select
        aria-label="Statement timeout"
        className="h-6 rounded border border-input bg-background px-1 text-[11px] outline-none"
        value={OPTIONS.some(([v]) => v === value) ? value : 'custom'}
        onChange={async (e) => {
          const ms = Number(e.target.value)
          actions.updateSession(await call('db:setStatementTimeout', { sessionId: session.id, ms }))
          actions.showToast(`Statement timeout: ${formatTimeout(ms)}`)
        }}
      >
        {!OPTIONS.some(([v]) => v === value) && <option value="custom">{formatTimeout(value)}</option>}
        {OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            Timeout: {label}
          </option>
        ))}
      </select>
    </label>
  )
}
