/**
 * Preload bridge: the only code with both DOM and IPC access.
 *
 * Exposes a minimal, allow-listed `window.viewdeck.invoke(channel, payload)` and
 * `window.viewdeck.on(event, listener)` for main → renderer push events.
 * It never exposes `ipcRenderer` itself, because that would let the renderer
 * send to any channel. Runs sandboxed, so only `electron`'s renderer modules
 * are available here (no `fs`, no `child_process`).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type ViewDeckBridge } from '@shared/ipc'

const allowed = new Set<string>(IPC_CHANNELS)
const allowedEvents = new Set<string>(IPC_EVENTS)

const bridge: ViewDeckBridge = {
  invoke: (channel: IpcChannel, ...args: unknown[]) => {
    if (!allowed.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'VALIDATION', message: `Unknown IPC channel: ${channel}` }
      })
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (event: string, listener: (payload: unknown) => void) => {
    if (!allowedEvents.has(event)) throw new Error(`Unknown IPC event: ${event}`)
    // Wrap so the renderer never receives the IpcRendererEvent (it exposes `sender`).
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.removeListener(event, wrapped)
    }
  }
} as ViewDeckBridge

contextBridge.exposeInMainWorld('viewdeck', bridge)
