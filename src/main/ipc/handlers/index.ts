import { registerAppHandlers } from './appHandlers'
import { registerAwsHandlers } from './awsHandlers'
import { registerDbHandlers } from './dbHandlers'
import { registerStoreHandlers } from './storeHandlers'
import { registerTunnelHandlers } from './tunnelHandlers'
import { registerUpdateHandlers } from './updateHandlers'

/** Registers every IPC domain. Add new `register<Domain>Handlers()` calls here. */
export function registerAllIpcHandlers(): void {
  registerAppHandlers()
  registerAwsHandlers()
  registerTunnelHandlers()
  registerStoreHandlers()
  registerDbHandlers()
  registerUpdateHandlers()
}
