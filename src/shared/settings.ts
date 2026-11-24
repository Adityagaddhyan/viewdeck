/**
 * User settings, stored in LocalStore prefs under `settings` and owned by main
 * (connection defaults are decided there). `normalizeSettings` makes any stored
 * or incoming value safe: unknown keys are dropped, bad values fall back to
 * defaults. Pure and unit-tested.
 */
import { defaultReadOnly, defaultStatementTimeoutMs, type EnvironmentTier } from './environment'

const TIERS: EnvironmentTier[] = ['prod', 'staging', 'dev', 'unknown']

export interface AppSettings {
  /** Rows per page in the table browser. */
  pageSize: 500 | 1000 | 5000
  editorFontSize: number
  theme: 'dark' | 'light' | 'system'
  /** How formatted epoch columns render. */
  dateDisplay: 'local' | 'utc'
  /** Whether new sessions start read-only, per environment tier. */
  readOnlyDefaults: Record<EnvironmentTier, boolean>
  /** Default statement timeout (ms, 0 = off) per environment tier. */
  timeoutDefaults: Record<EnvironmentTier, number>
  /** Check GitHub Releases for a new version at launch and every 12 hours. */
  checkForUpdates: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  pageSize: 1000,
  editorFontSize: 13,
  theme: 'dark',
  dateDisplay: 'local',
  readOnlyDefaults: Object.fromEntries(TIERS.map((t) => [t, defaultReadOnly(t)])) as Record<EnvironmentTier, boolean>,
  timeoutDefaults: Object.fromEntries(TIERS.map((t) => [t, defaultStatementTimeoutMs(t)])) as Record<EnvironmentTier, number>,
  checkForUpdates: true
}

export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AppSettings, unknown>>
  const ro = (r.readOnlyDefaults ?? {}) as Partial<Record<EnvironmentTier, unknown>>
  const to = (r.timeoutDefaults ?? {}) as Partial<Record<EnvironmentTier, unknown>>
  const font = Number(r.editorFontSize)
  return {
    pageSize: r.pageSize === 500 || r.pageSize === 5000 ? r.pageSize : 1000,
    editorFontSize: Number.isFinite(font) ? Math.min(20, Math.max(10, Math.round(font))) : DEFAULT_SETTINGS.editorFontSize,
    theme: r.theme === 'light' || r.theme === 'system' ? r.theme : 'dark',
    dateDisplay: r.dateDisplay === 'utc' ? 'utc' : 'local',
    readOnlyDefaults: Object.fromEntries(TIERS.map((t) => [t, typeof ro[t] === 'boolean' ? ro[t] : DEFAULT_SETTINGS.readOnlyDefaults[t]])) as Record<EnvironmentTier, boolean>,
    timeoutDefaults: Object.fromEntries(
      TIERS.map((t) => {
        const v = Number(to[t])
        return [t, Number.isFinite(v) && v >= 0 ? Math.min(24 * 3_600_000, Math.floor(v)) : DEFAULT_SETTINGS.timeoutDefaults[t]]
      })
    ) as Record<EnvironmentTier, number>,
    checkForUpdates: r.checkForUpdates !== false
  }
}
