/**
 * Last line of defence for errors nothing else caught in the main process.
 * Electron's default for an uncaught exception is a modal "A JavaScript error occurred"
 * box. For a dropped network socket (VPN off, laptop asleep, tunnel closed) that is
 * noise: the query that used it has already failed and the pool reconnects. Those are
 * logged. Anything else is a real bug, so the user still sees it.
 */
import { dialog } from 'electron'

/** Socket-level error codes that only mean "the connection went away". */
const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'ENOTCONN', 'EAI_AGAIN'])

/** True for a lost or unreachable connection (by code, or pg's "Connection terminated" errors). */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return true
  return /^Connection terminated( unexpectedly)?$/.test(err.message)
}

/** Installs the uncaught-exception / unhandled-rejection handlers. Call once at startup. */
export function installCrashGuard(): void {
  process.on('uncaughtException', (err) => {
    if (isNetworkError(err)) {
      console.warn('[viewdeck] ignored network error:', err.message)
      return
    }
    console.error('[viewdeck] uncaught exception:', err)
    dialog.showErrorBox('ViewDeck hit an unexpected error', err instanceof Error ? (err.stack ?? err.message) : String(err))
  })
  process.on('unhandledRejection', (reason) => {
    if (isNetworkError(reason)) console.warn('[viewdeck] ignored network rejection:', (reason as Error).message)
    else console.error('[viewdeck] unhandled rejection:', reason)
  })
}
