/**
 * Type-safe wrapper around `ipcMain.handle`.
 *
 * Handlers return plain data or throw. `registerHandler` converts both into an
 * `IpcResult`, so the renderer always gets a serializable `{ ok, data | error }`
 * envelope and never a mangled Electron error string.
 */
import { ipcMain } from 'electron'
import type { IpcChannel, IpcContract, IpcRequest, IpcResponse } from '@shared/ipc'
import { toAppError } from './toAppError'

export type IpcHandler<C extends IpcChannel> = (
  request: IpcRequest<C>
) => Promise<IpcContract[C]['response']> | IpcContract[C]['response']

/** Registers one channel. Call it once per channel at startup (see handlers/index.ts). */
export function registerHandler<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, async (_event, request: IpcRequest<C>): Promise<IpcResponse<C>> => {
    try {
      return { ok: true, data: await handler(request) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
