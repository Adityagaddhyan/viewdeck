import type { AppError } from '@shared/types/result'

/**
 * Error subclass carrying a stable {@link AppError} code. Throw it from services
 * when the UI should show a specific remediation (expired SSO, missing plugin...).
 */
export class AppErrorException extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message)
    this.name = 'AppErrorException'
  }
}

/** Normalises anything thrown in main into a serializable AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppErrorException) return err.appError
  if (err instanceof Error) {
    return { code: 'UNKNOWN', message: err.message, detail: err.stack }
  }
  return { code: 'UNKNOWN', message: String(err) }
}
