/**
 * Manual "Check for Updates…" (menu, ⌘K). The banner (features/update/UpdateBanner)
 * listens to `update:status` itself; this only adds feedback when nothing is new.
 */
import { call } from './ipc'
import { actions } from './store'

export async function checkForUpdatesNow(): Promise<void> {
  try {
    const status = await call('update:check')
    if (status.state === 'idle') actions.showToast(`You're on the latest version (ViewDeck ${status.current}).`)
    else if (status.state === 'error') actions.showToast(status.message)
    else if (status.state === 'ready') actions.showToast(`ViewDeck ${status.release.version} is ready. Restart to finish updating.`)
  } catch (err) {
    actions.showToast(`Couldn't check for updates: ${(err as Error).message}`)
  }
}
