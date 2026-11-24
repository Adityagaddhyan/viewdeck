/**
 * App-level UI state: which screen is showing, the live session, and the
 * workspace tabs. A tiny external store read with useSyncExternalStore. It
 * has no dependencies, and any component can subscribe to a slice.
 *
 * Server state (schemas, rows) is NOT kept here. Components fetch it through
 * `call()`. Only navigation and session state live in this store.
 */
import { useSyncExternalStore } from 'react'
import type { SessionInfo } from '@shared/types/connection'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import type { RowSnapshot } from '@renderer/features/grid/compareRows'
import { normalizeSplit, type SplitPanes } from './splitView'

export type Tab =
  | { id: string; kind: 'query'; title: string; sql: string }
  | {
      id: string
      kind: 'table'
      title: string
      schema: string
      table: string
      /** Bumped to ask the tab to open its info drawer (sidebar "Show info & DDL"). */
      infoRequest?: number
      /** Ask the tab to apply this filter (FK navigation, restore). `n` makes repeats distinct. */
      filterRequest?: { where: string; orderBy?: string; n: number }
      /** Last applied filter, persisted with the workspace. */
      savedFilter?: { where: string; orderBy: string }
    }
  | {
      id: string
      kind: 'diagram'
      title: string
      schema: string
      /** Ask the diagram to focus this table (`n` makes repeats distinct). */
      focusRequest?: { table: string; n: number }
    }

export type Screen = { name: 'home' } | { name: 'aws-wizard' } | { name: 'workspace' }

export interface AppState {
  screen: Screen
  session: SessionInfo | null
  tabs: Tab[]
  activeTabId: string | null
  /** Shown on the home screen after a session ends unexpectedly. */
  notice: string | null
  /** Command palette (Cmd/Ctrl+K) visibility. */
  paletteOpen: boolean
  /** Bumped to make schema views reload (after DDL, or "Refresh schema"). */
  schemaVersion: number
  /** Short-lived confirmation shown bottom-centre (e.g. "Copied row as JSON"). */
  toast: { id: number; text: string } | null
  /** Table tabs holding staged (uncommitted) edits. Switching connection asks first. */
  dirtyTabs: string[]
  /** Last tab-scoped menu command (run, review…); the active tab acts on it. `n` makes repeats distinct. */
  tabCommand: { id: 'runStatement' | 'cancelQuery' | 'reviewChanges' | 'focusFilter'; n: number } | null
  /** Settings dialog visibility. */
  settingsOpen: boolean
  /** App settings (loaded at start from main via settings:get). */
  settings: AppSettings
  /** Auto-reconnect in progress after a lost session (tunnel died). */
  reconnecting: { attempt: number; of: number; reason: string; nextInMs: number } | null
  /** Two tabs side by side (splitView.ts keeps it consistent with activeTabId). */
  split: SplitPanes | null
  /** Row pinned with "Pin row for comparison" (any tab / table / result). */
  pinnedRow: RowSnapshot | null
  /** Open "compare rows" dialog. */
  compare: { a: RowSnapshot; b: RowSnapshot } | null
}

const initial: AppState = { screen: { name: 'home' }, session: null, tabs: [], activeTabId: null, notice: null, paletteOpen: false, schemaVersion: 0, toast: null, dirtyTabs: [], tabCommand: null, settingsOpen: false, settings: DEFAULT_SETTINGS, reconnecting: null, split: null, pinnedRow: null, compare: null }

let state = initial
const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const prev = state
  const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  // Keep the split view consistent with whatever changed the active tab or closed tabs.
  if (next.split && (next.activeTabId !== prev.activeTabId || next.tabs !== prev.tabs || next.split !== prev.split)) {
    next.split = normalizeSplit(next.split, prev.activeTabId, next.activeTabId, next.tabs.map((t) => t.id))
  }
  state = next
  for (const l of listeners) l()
}

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => select(state)
  )
}

let afterSilentChange: (() => void) | null = null
/** Subscribe to store changes, including silent ones (editor text, table filters). Used by persistence. */
export function subscribeAll(fn: () => void): () => void {
  listeners.add(fn)
  afterSilentChange = fn
  return () => {
    listeners.delete(fn)
    if (afterSilentChange === fn) afterSilentChange = null
  }
}

let tabSeq = 0
const newTabId = (): string => `tab-${++tabSeq}`

export const actions = {
  /** Shows the workspace for `session`, with restored tabs when given (workspacePersistence). */
  openSession(session: SessionInfo, restored?: { tabs: Tab[]; activeIndex: number }): void {
    const tabs = restored?.tabs.length ? restored.tabs : [{ id: newTabId(), kind: 'query' as const, title: 'Query 1', sql: '' }]
    const active = tabs[Math.min(Math.max(0, restored?.activeIndex ?? 0), tabs.length - 1)]
    setState({ session, screen: { name: 'workspace' }, tabs, activeTabId: active?.id ?? null, notice: null, dirtyTabs: [] })
  },
  /** Fresh tab id (also used when restoring persisted tabs). */
  newTabId: (): string => newTabId(),
  setTableFilter(id: string, filter: { where: string; orderBy: string }): void {
    const tab = state.tabs.find((t) => t.id === id)
    if (tab?.kind === 'table') {
      tab.savedFilter = filter // no re-render needed; read by persistence
      afterSilentChange?.()
    }
  },
  endSession(notice: string | null = null): void {
    setState({ session: null, screen: { name: 'home' }, tabs: [], activeTabId: null, notice, dirtyTabs: [], split: null, compare: null })
  },
  updateSession(session: SessionInfo): void {
    setState({ session })
  },
  openTable(schema: string, table: string, opts: { info?: boolean; where?: string } = {}): void {
    const infoRequest = opts.info ? Date.now() : undefined
    const filterRequest = opts.where !== undefined ? { where: opts.where, n: Date.now() } : undefined
    const existing = state.tabs.find((t) => t.kind === 'table' && t.schema === schema && t.table === table)
    if (existing) {
      return setState((s) => ({
        activeTabId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === existing.id && t.kind === 'table' ? { ...t, ...(infoRequest ? { infoRequest } : {}), ...(filterRequest ? { filterRequest } : {}) } : t
        )
      }))
    }
    const tab: Tab = { id: newTabId(), kind: 'table', title: table, schema, table, infoRequest, filterRequest }
    setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },
  /** Opens (or reuses) the ER diagram tab for `schema`, optionally focusing one table. */
  openDiagram(schema: string, focusTable?: string): void {
    const focusRequest = focusTable ? { table: focusTable, n: Date.now() } : undefined
    const existing = state.tabs.find((t) => t.kind === 'diagram' && t.schema === schema)
    if (existing) {
      return setState((s) => ({
        activeTabId: existing.id,
        tabs: s.tabs.map((t) => (t.id === existing.id && t.kind === 'diagram' && focusRequest ? { ...t, focusRequest } : t))
      }))
    }
    const tab: Tab = { id: newTabId(), kind: 'diagram', title: `${schema} diagram`, schema, focusRequest }
    setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },
  newQueryTab(sql = ''): void {
    const n = state.tabs.filter((t) => t.kind === 'query').length + 1
    const tab: Tab = { id: newTabId(), kind: 'query', title: `Query ${n}`, sql }
    setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },
  /** Call after schemaCache.invalidate() so mounted schema views reload. */
  bumpSchemaVersion(): void {
    setState((s) => ({ schemaVersion: s.schemaVersion + 1 }))
  },
  showToast(text: string): void {
    const id = Date.now()
    setState({ toast: { id, text } })
    setTimeout(() => {
      if (state.toast?.id === id) setState({ toast: null })
    }, 1800)
  },
  cycleTab(step: 1 | -1): void {
    const { tabs, activeTabId } = state
    if (tabs.length < 2) return
    const i = tabs.findIndex((t) => t.id === activeTabId)
    const next = tabs[(i + step + tabs.length) % tabs.length]
    if (next) setState({ activeTabId: next.id })
  },
  closeOtherTabs(id: string): void {
    setState((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeTabId: id }))
  },
  closeAllTabs(): void {
    setState({ tabs: [], activeTabId: null })
  },
  dispatchTabCommand(id: NonNullable<AppState['tabCommand']>['id']): void {
    setState({ tabCommand: { id, n: Date.now() } })
  },
  setSettings(settings: AppSettings): void {
    setState({ settings })
  },
  setSettingsOpen(open: boolean): void {
    setState({ settingsOpen: open })
  },
  setPalette(open: boolean): void {
    setState({ paletteOpen: open })
  },
  /** Shows `id` next to the active tab (opens a new query tab when `id` is omitted or already active). */
  splitWith(id?: string): void {
    const left = state.activeTabId
    if (!left) return
    let right = id && id !== left ? id : undefined
    if (!right) {
      actions.newQueryTab()
      right = state.activeTabId ?? undefined
      if (!right) return
      setState({ activeTabId: left })
    }
    setState({ split: { left, right }, activeTabId: right })
  },
  closeSplit(): void {
    setState({ split: null })
  },
  pinRow(row: RowSnapshot): void {
    setState({ pinnedRow: row })
    actions.showToast(`Pinned row from ${row.label}. Right-click another row to compare.`)
  },
  compareRows(a: RowSnapshot, b: RowSnapshot): void {
    setState({ compare: { a, b } })
  },
  closeCompare(): void {
    setState({ compare: null })
  },
  activateTab(id: string): void {
    setState({ activeTabId: id })
  },
  setTabDirty(id: string, dirty: boolean): void {
    if (dirty === state.dirtyTabs.includes(id)) return
    setState((s) => ({ dirtyTabs: dirty ? [...s.dirtyTabs, id] : s.dirtyTabs.filter((t) => t !== id) }))
  },
  closeTab(id: string): void {
    actions.setTabDirty(id, false)
    setState((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTabId = s.activeTabId === id ? (tabs[Math.max(0, idx - 1)]?.id ?? null) : s.activeTabId
      return { tabs, activeTabId }
    })
  },
  setQuerySql(id: string, sql: string): void {
    // Not broadcast to listeners on every keystroke: the editor owns its text.
    // The tab only keeps the latest value for remounts and persistence.
    const tab = state.tabs.find((t) => t.id === id)
    if (tab?.kind === 'query') {
      tab.sql = sql
      afterSilentChange?.()
    }
  }
}
