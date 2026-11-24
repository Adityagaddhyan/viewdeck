import { app } from 'electron'
import { getServices } from '../../services'
import { registerHandler } from '../registry'

/** `update:*` channels: check GitHub Releases, download + verify, restart into the new version. */
export function registerUpdateHandlers(): void {
  const s = getServices()
  registerHandler('update:getStatus', () => s.updates.current)
  registerHandler('update:check', () => s.updates.check())
  registerHandler('update:download', () => s.updates.download())
  registerHandler('update:restart', () => {
    // before-quit runs installOnQuit(), which starts the swap and relaunch.
    if (s.updates.requestRestart()) setImmediate(() => app.quit())
  })
}
