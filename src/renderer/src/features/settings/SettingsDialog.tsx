/**
 * Settings (⌘, / menu): page size, editor font size, theme, date display, and
 * per-environment defaults for new sessions (start read-only, statement
 * timeout). Saved through settings:set (normalised in main).
 */
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ENV_COLORS, type EnvironmentTier } from '@shared/environment'
import type { AppSettings } from '@shared/settings'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Field, Select } from '@renderer/components/ui/primitives'
import { call } from '@renderer/lib/ipc'
import { actions, useAppState } from '@renderer/lib/store'

const TIERS: EnvironmentTier[] = ['prod', 'staging', 'dev', 'unknown']
const TIMEOUTS: Array<[number, string]> = [
  [0, 'Off'],
  [5_000, '5s'],
  [30_000, '30s'],
  [60_000, '1m'],
  [300_000, '5m'],
  [900_000, '15m']
]

export function SettingsDialog() {
  const open = useAppState((s) => s.settingsOpen)
  const current = useAppState((s) => s.settings)
  const [d, setD] = useState<AppSettings>(current)
  useEffect(() => {
    if (open) setD(current)
  }, [open, current])
  if (!open) return null
  const set = (patch: Partial<AppSettings>): void => setD({ ...d, ...patch })

  const save = async (): Promise<void> => {
    actions.setSettings(await call('settings:set', { settings: d }))
    actions.setSettingsOpen(false)
    actions.showToast('Settings saved')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && actions.setSettingsOpen(false)}>
      <DialogContent title="Settings" description="Connection defaults apply to new sessions." className="max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Theme">
            <Select aria-label="Theme" value={d.theme} onChange={(e) => set({ theme: e.target.value as AppSettings['theme'] })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System (follow macOS)</option>
            </Select>
          </Field>
          <Field label="Editor font size">
            <Select aria-label="Editor font size" value={d.editorFontSize} onChange={(e) => set({ editorFontSize: Number(e.target.value) })}>
              {[11, 12, 13, 14, 15, 16, 18].map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rows per page (table browser)">
            <Select aria-label="Rows per page" value={d.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) as AppSettings['pageSize'] })}>
              <option value={500}>500</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
            </Select>
          </Field>
          <Field label="Formatted dates">
            <Select aria-label="Formatted dates" value={d.dateDisplay} onChange={(e) => set({ dateDisplay: e.target.value as AppSettings['dateDisplay'] })}>
              <option value="local">Local time</option>
              <option value="utc">UTC</option>
            </Select>
          </Field>
        </div>

        <h3 className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">New session defaults per environment</h3>
        <div className="space-y-1.5">
          {TIERS.map((t) => (
            <div key={t} className="flex items-center gap-3 text-xs">
              <span className="size-2 rounded-full" style={{ backgroundColor: ENV_COLORS[t] }} />
              <span className="w-16">{t}</span>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  aria-label={`${t} starts read-only`}
                  checked={d.readOnlyDefaults[t]}
                  onChange={(e) => set({ readOnlyDefaults: { ...d.readOnlyDefaults, [t]: e.target.checked } })}
                />
                starts read-only
              </label>
              <select
                aria-label={`${t} statement timeout`}
                className="ml-auto h-6 rounded border border-input bg-background px-1 text-[11px]"
                value={d.timeoutDefaults[t]}
                onChange={(e) => set({ timeoutDefaults: { ...d.timeoutDefaults, [t]: Number(e.target.value) } })}
              >
                {!TIMEOUTS.some(([v]) => v === d.timeoutDefaults[t]) && <option value={d.timeoutDefaults[t]}>{Math.round(d.timeoutDefaults[t] / 1000)}s</option>}
                {TIMEOUTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    timeout {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {(!d.readOnlyDefaults.prod || !d.readOnlyDefaults.unknown) && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
              <AlertTriangle className="size-3" /> Production or unknown sessions will start writable. Writes still need staging and review.
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => actions.setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
