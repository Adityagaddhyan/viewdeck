/**
 * Renderer-side IPC helpers. `call()` unwraps the IpcResult envelope and throws
 * an {@link IpcError} carrying the AppError, which components render with
 * <ErrorBanner>. Components should use `call()` and never touch
 * `window.viewdeck` directly.
 */
import type { IpcChannel, IpcContract, IpcEventName, IpcEvents, IpcRequest } from '@shared/ipc'
import type { AppError } from '@shared/types/result'

export class IpcError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message)
    this.name = 'IpcError'
  }
}

/** Normalises anything thrown in the renderer into an AppError for display. */
export function asAppError(err: unknown): AppError {
  if (err instanceof IpcError) return err.appError
  if (err instanceof Error) return { code: 'UNKNOWN', message: err.message }
  return { code: 'UNKNOWN', message: String(err) }
}

export async function call<C extends IpcChannel>(
  channel: C,
  ...args: IpcRequest<C> extends void ? [] : [IpcRequest<C>]
): Promise<IpcContract[C]['response']> {
  const res = await window.viewdeck.invoke(channel, ...args)
  if (!res.ok) throw new IpcError(res.error)
  return res.data
}

export function onEvent<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
  return window.viewdeck.on(event, listener)
}
