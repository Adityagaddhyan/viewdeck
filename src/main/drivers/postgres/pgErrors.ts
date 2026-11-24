/**
 * Maps node-postgres and socket errors to actionable AppErrors.
 *
 * Uses SQLSTATE codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
 * where available, and Node error codes for socket and TLS failures.
 */
import type { AppError } from '@shared/types/result'
import { AppErrorException } from '../../ipc/toAppError'

interface PgLikeError {
  message?: string
  code?: string
  detail?: string
  hint?: string
  position?: string
}

export interface PgErrorContext {
  iam: boolean
  user: string
  host: string
}

export function toPgAppError(err: unknown, ctx: PgErrorContext): AppError {
  if (err instanceof AppErrorException) return err.appError
  const e = (err ?? {}) as PgLikeError
  const message = e.message ?? String(err)
  const detail = [e.detail, e.hint, e.position ? `at position ${e.position}` : null].filter(Boolean).join('\n') || undefined

  switch (e.code) {
    case '28P01':
    case '28000':
      return ctx.iam
        ? {
            code: 'DB_AUTH_FAILED',
            message: `IAM authentication failed for database user "${ctx.user}".`,
            hint: 'RDS rejected the IAM token. Usually one of these is missing:',
            steps: [
              'IAM database authentication is enabled on the instance or cluster (Modify → Database authentication).',
              `The database user exists and has the rds_iam role (run the command below as an admin).`,
              `Your AWS role allows rds-db:connect on arn:aws:rds-db:<region>:<account>:dbuser:<DbiResourceId>/${ctx.user}.`,
              'The connection uses the real RDS endpoint and region (ViewDeck signs for the endpoint, even through a tunnel).',
              "Your computer's clock is accurate. Tokens are time-limited signatures."
            ],
            command: `GRANT rds_iam TO "${ctx.user.replace(/"/g, '""')}";`,
            docsUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.Troubleshooting.html',
            detail: message
          }
        : { code: 'DB_AUTH_FAILED', message: `Authentication failed for user "${ctx.user}".`, hint: 'Check the username and password.', detail: message }
    case '25006':
      return {
        code: 'DB_READ_ONLY',
        message: 'This session is read-only.',
        hint: 'Unlock the read-only toggle in the toolbar to make changes.',
        detail: message
      }
    case '57014':
      return /statement timeout/i.test(message)
        ? {
            code: 'DB_QUERY_FAILED',
            message: 'Query exceeded the statement timeout and was cancelled.',
            hint: 'Raise or turn off the timeout in the query toolbar (Timeout ▾), or narrow the query.',
            detail: message
          }
        : { code: 'DB_QUERY_FAILED', message: 'Query cancelled.', detail: message }
    case '3D000':
      return { code: 'DB_CONNECTION_FAILED', message, hint: 'Check the database name.' }
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ECONNRESET':
      return {
        code: 'DB_CONNECTION_FAILED',
        message: `Could not reach ${ctx.host} (${e.code}).`,
        hint: 'The database did not accept a TCP connection.',
        steps: [
          'A private database (not publicly accessible) is reachable Direct only while your VPN or peered network is connected. Otherwise edit the connection and use an SSM tunnel.',
          "Check that the database's security group allows your IP, or the tunnel host, on the database port.",
          'Check that the instance status is "available".'
        ],
        detail: message
      }
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return {
        code: 'DB_CONNECTION_FAILED',
        message: 'TLS certificate verification failed.',
        hint: "The server's certificate did not match the expected hostname or CA.",
        steps: [
          'For RDS, keep TLS on verify-full. ViewDeck uses the bundled RDS CA and verifies the real endpoint, even through a tunnel.',
          'For a self-hosted server with a private CA, use "require" (encrypted, not verified).'
        ],
        detail: message
      }
  }
  if (/timeout expired|Connection terminated/i.test(message)) {
    return { code: 'DB_CONNECTION_FAILED', message, hint: 'The database did not respond. Check the network path or tunnel.' }
  }
  if (/does not support SSL/i.test(message)) {
    return { code: 'DB_CONNECTION_FAILED', message, hint: 'Set TLS mode to disable for this server.' }
  }
  const position = e.position ? Number(e.position) : undefined
  return { code: 'DB_QUERY_FAILED', message, detail, ...(position ? { context: { position } } : {}) }
}

/** Runs `fn` and rethrows failures as categorised AppErrorExceptions. */
export async function withPgErrors<T>(ctx: PgErrorContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw new AppErrorException(toPgAppError(err, ctx))
  }
}
