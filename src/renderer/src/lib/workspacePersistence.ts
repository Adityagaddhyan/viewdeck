/**
 * Persists each saved connection's workspace (open tabs, editor text, table
 * filters, active tab) in LocalStore `prefs` under `workspace:<connectionId>`,
 * and restores it on reconnect. Saves are debounced. Serialisation is pure and
 * unit-tested (`serializeWorkspace` / `restoreWorkspace`).
 */
import { call } from './ipc'
import { actions, getState, subscribeAll, type Tab } from './store'

export interface SavedWorkspace {
  v: 1
  activeIndex: number
  tabs: Array<
    | { kind: 'query'; title: string; sql: string }
    | { kind: 'table'; title: string; schema: string; table: string; where?: string; orderBy?: string }
  >
}

const KEY = (connectionId: string): string => `workspace:${connectionId}`
/** Editor text beyond this isn't persisted (keeps prefs small). */
const MAX_SQL = 200_000

export function serializeWorkspace(tabs: Tab[], activeTabId: string | null): SavedWorkspace {
  return {
    v: 1,
    activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId)),
    tabs: tabs.map((t) =>
      t.kind === 'query'
        ? { kind: 'query', title: t.title, sql: t.sql.slice(0, MAX_SQL) }
        : { kind: 'table', title: t.title, schema: t.schema, table: t.table, where: t.savedFilter?.where || undefined, orderBy: t.savedFilter?.orderBy || undefined }
    )
  }
}

export function restoreWorkspace(saved: unknown, newId: () => string): { tabs: Tab[]; activeIndex: number } | null {
  const w = saved as SavedWorkspace | null
  if (!w || w.v !== 1 || !Array.isArray(w.tabs)) return null
  const n = Date.now()
  const tabs: Tab[] = w.tabs.map((t) =>
    t.kind === 'query'
      ? { id: newId(), kind: 'query', title: t.title, sql: t.sql ?? '' }
      : {
          id: newId(),
          kind: 'table',
          title: t.title,
          schema: t.schema,
          table: t.table,
          ...(t.where || t.orderBy ? { filterRequest: { where: t.where ?? '', orderBy: t.orderBy ?? '', n }, savedFilter: { where: t.where ?? '', orderBy: t.orderBy ?? '' } } : {})
        }
  )
  return { tabs, activeIndex: w.activeIndex ?? 0 }
}

export async function loadWorkspace(connectionId: string | null): Promise<{ tabs: Tab[]; activeIndex: number } | null> {
  if (!connectionId) return null
  const saved = await call('prefs:get', { key: KEY(connectionId) }).catch(() => null)
  return restoreWorkspace(saved, actions.newTabId)
}

let timer: ReturnType<typeof setTimeout> | null = null
let firstPendingAt: number | null = null
const DEBOUNCE_MS = 600
/** Continuous activity still saves at least this often. */
const MAX_WAIT_MS = 3000

/**
 * Saves the current workspace right away (if one is open). Called before a
 * session is left or switched, and on window unload, because a pending
 * debounced save would otherwise be lost when the tabs are cleared.
 */
export function flushWorkspaceSave(): void {
  if (timer) clearTimeout(timer)
  timer = null
  firstPendingAt = null
  const { session, tabs, activeTabId, screen } = getState()
  if (!session?.connectionId || screen.name !== 'workspace') return
  void call('prefs:set', { key: KEY(session.connectionId), value: serializeWorkspace(tabs, activeTabId) }).catch(() => {})
}

/** Starts debounced auto-save (600 ms, max 3 s). Call once at app start. */
export function startWorkspacePersistence(): () => void {
  const onUnload = (): void => flushWorkspaceSave()
  window.addEventListener('beforeunload', onUnload)
  const unsubscribe = subscribeAll(() => {
    const now = Date.now()
    firstPendingAt ??= now
    if (timer) clearTimeout(timer)
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - firstPendingAt)))
    timer = setTimeout(flushWorkspaceSave, wait)
  })
  return () => {
    window.removeEventListener('beforeunload', onUnload)
    unsubscribe()
  }
}
