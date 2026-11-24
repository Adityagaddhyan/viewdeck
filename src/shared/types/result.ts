/**
 * Error envelope used across the IPC boundary.
 *
 * Why: Electron serialises thrown errors across `ipcRenderer.invoke` lossily
 * (custom fields and class identity are dropped, and the message gets a
 * "Error invoking remote method" prefix). Main-process handlers therefore never
 * throw to the renderer. They return an {@link IpcResult} with a stable `code`
 * the UI can map to an actionable banner (e.g. "run `aws sso login`").
 */
export type AppErrorCode =
  | 'UNKNOWN'
  | 'VALIDATION'
  | 'AWS_SSO_EXPIRED'
  | 'AWS_CREDENTIALS_MISSING'
  | 'AWS_ACCESS_DENIED'
  | 'AWS_NETWORK_ERROR'
  | 'AWS_CLI_MISSING'
  | 'SSM_PLUGIN_MISSING'
  | 'SSM_TUNNEL_FAILED'
  | 'DB_CONNECTION_FAILED'
  | 'DB_AUTH_FAILED'
  | 'DB_QUERY_FAILED'
  | 'DB_READ_ONLY'
  | 'NOT_FOUND'

/** Serializable error payload returned to the renderer. */
export interface AppError {
  code: AppErrorCode
  /** Human-readable summary. Safe to show in the UI. */
  message: string
  /** Optional remediation hint, e.g. a shell command to run. */
  hint?: string
  /** Optional raw detail (driver message, stack) for a "details" disclosure. */
  detail?: string
  /** A shell or SQL command that fixes the problem. The banner shows it with a copy button. */
  command?: string
  /** Ordered troubleshooting checklist for problems with several possible causes. */
  steps?: string[]
  /** Official documentation for the fix. Opens in the OS browser. */
  docsUrl?: string
  /**
   * Machine-readable context for inline actions, e.g. `profile` lets the banner
   * offer "Sign in with AWS SSO" for AWS_SSO_EXPIRED.
   */
  context?: {
    profile?: string
    /** 1-based character offset of a SQL error in the submitted text (Postgres `position`). */
    position?: number
  }
}

/** Discriminated union every IPC handler resolves to. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppError }

export const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })
export const fail = (error: AppError): IpcResult<never> => ({ ok: false, error })
