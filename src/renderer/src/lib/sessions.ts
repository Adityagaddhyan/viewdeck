/**
 * Session transitions used by every "connect" entry point (home, switcher,
 * wizard, manual dialog, palette). Opening a new session always disconnects the
 * previous one in main, so sessions (and their SSM tunnels) never leak.
 */
import type { SessionInfo } from '@shared/types/connection'
import { schemaCache } from '@renderer/features/editor/schemaCache'
import { call } from './ipc'
import { actions, getState } from './store'
import { flushWorkspaceSave, loadWorkspace } from './workspacePersistence'

/** Shows `next` in the workspace and disconnects whatever session was open before. */
export async function enterSession(next: SessionInfo): Promise<void> {
  flushWorkspaceSave() // keep the outgoing connection's latest tabs
  const prev = getState().session
  // Restore this connection's tabs, editor text and filters from last time.
  actions.openSession(next, (await loadWorkspace(next.connectionId)) ?? undefined)
  if (prev && prev.id !== next.id) await call('db:disconnect', { sessionId: prev.id }).catch(() => {})
}

/** Connects a saved connection and enters it. Rejects (leaving the current session alone) on failure. */
export async function connectTo(connectionId: string): Promise<SessionInfo> {
  const next = await call('db:connect', { connectionId })
  await enterSession(next)
  return next
}

/** Disconnects the current session and returns to Home. */
export async function leaveSession(notice: string | null = null): Promise<void> {
  flushWorkspaceSave()
  const prev = getState().session
  schemaCache.use(null)
  actions.endSession(notice)
  if (prev) await call('db:disconnect', { sessionId: prev.id }).catch(() => {})
}

/** True when any table tab has staged edits that a switch would discard. */
export const hasStagedEdits = (): boolean => getState().dirtyTabs.length > 0
