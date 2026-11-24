/**
 * Reconnects a lost session (e.g. its SSM tunnel died) with backoff, keeping
 * the workspace (tabs, editor text, staged edits) instead of dropping to Home.
 * `reconnectWithBackoff` is pure orchestration, tested with fake connect/sleep.
 */
import type { SessionInfo } from '@shared/types/connection'
import { asAppError, call } from './ipc'
import { actions, getState, setState } from './store'

export const BACKOFF_MS = [1000, 3000, 10000, 30000]

export async function reconnectWithBackoff(
  connect: () => Promise<SessionInfo>,
  onAttempt: (attempt: number, waitMs: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  isCancelled: () => boolean = () => false
): Promise<SessionInfo | null> {
  for (const [i, wait] of BACKOFF_MS.entries()) {
    onAttempt(i + 1, wait)
    await sleep(wait)
    if (isCancelled()) return null
    try {
      return await connect()
    } catch {
      /* next attempt */
    }
  }
  return null
}

/** Called on session:lost. Shows a banner, retries, then swaps in the new session (same tabs). */
export async function recoverSession(lostSessionId: string, reason: string): Promise<void> {
  const session = getState().session
  if (!session || session.id !== lostSessionId) return
  if (!session.connectionId) return actions.endSession(`Disconnected: ${reason}`)
  const connectionId = session.connectionId
  const next = await reconnectWithBackoff(
    () => call('db:connect', { connectionId }),
    (attempt, waitMs) => setState({ reconnecting: { attempt, of: BACKOFF_MS.length, reason, nextInMs: waitMs } }),
    undefined,
    () => getState().session?.connectionId !== connectionId
  ).catch((e: unknown) => {
    reason = asAppError(e).message
    return null
  })
  setState({ reconnecting: null })
  if (next) {
    actions.updateSession({ ...next, readOnly: next.readOnly }) // same tabs; components refetch with the new session id
    actions.showToast('Reconnected')
  } else if (getState().session?.connectionId === connectionId) {
    actions.endSession(`Disconnected: ${reason}. Reconnecting failed.`)
  }
}
