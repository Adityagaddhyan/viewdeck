import { BrowserWindow } from 'electron'
import type { IpcEventName, IpcEvents } from '@shared/ipc'

/** Sends a typed push event to every open window (see IpcEvents in src/shared/ipc.ts). */
export function broadcast<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}
