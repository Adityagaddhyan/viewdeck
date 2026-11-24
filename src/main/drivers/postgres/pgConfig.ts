/**
 * Builds a `pg.PoolConfig` from an engine-agnostic DriverConnectionConfig.
 *
 * The two edge cases that matter (ADR-002):
 *
 * 1. RDS IAM auth: `password` is a FUNCTION, not a string. pg-pool creates a
 *    new Client for each physical connection, and each Client calls the
 *    function once during its handshake, so every connection gets a freshly
 *    signed 15-minute token. A string would be one token reused forever,
 *    breaking every connection opened more than 15 minutes later.
 *
 * 2. TLS over an SSM tunnel: the socket goes to 127.0.0.1, but the RDS
 *    certificate names `*.rds.amazonaws.com`. We set `ssl.servername` to the
 *    real endpoint. Node uses servername for SNI and the hostname check, and pg
 *    leaves it alone when `host` is an IP address. Paired with the bundled RDS
 *    CA, that gives full `verify-full` semantics through the tunnel.
 *
 * Pure function: no I/O, fully unit-tested.
 */
import { isIP } from 'node:net'
import type { ConnectionOptions } from 'node:tls'
import type { PoolConfig } from 'pg'
import type { DriverConnectionConfig } from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'
import { gridTypes } from './typeParsers'

export interface PgConfigInputs {
  config: DriverConnectionConfig
  /** Resolved password string (password auth) or per-connection token provider (IAM). */
  password: string | (() => Promise<string>)
  /** RDS CA bundle PEM, needed when tls.useRdsCaBundle is set. */
  rdsCaBundle: () => string
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/i

export function buildTlsOptions(
  config: DriverConnectionConfig,
  rdsCaBundle: () => string
): false | ConnectionOptions {
  const { tls, host } = config
  if (tls.mode === 'disable') {
    if (config.auth.kind === 'rds-iam') {
      throw new AppErrorException({
        code: 'VALIDATION',
        message: 'RDS IAM authentication requires TLS.',
        hint: 'Set TLS mode to verify-full.'
      })
    }
    return false
  }
  if (tls.mode === 'require') {
    // libpq "require": encrypted, but the certificate is not verified.
    return { rejectUnauthorized: false }
  }

  const servername = tls.servername ?? (isIP(host) === 0 && !LOOPBACK.test(host) ? host : undefined)
  if (!servername) {
    throw new AppErrorException({
      code: 'VALIDATION',
      message: `verify-full needs the real server hostname, but the socket host is ${host}.`,
      hint: 'When connecting through a tunnel, set tls.servername to the RDS endpoint.'
    })
  }
  return {
    rejectUnauthorized: true,
    servername,
    ...(tls.useRdsCaBundle ? { ca: rdsCaBundle() } : {})
  }
}

export function buildPoolConfig({ config, password, rdsCaBundle }: PgConfigInputs): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.auth.user,
    password,
    ssl: buildTlsOptions(config, rdsCaBundle),
    types: gridTypes,
    application_name: 'ViewDeck',
    // Desktop GUI: a few connections are plenty and kinder to prod databases.
    max: 4,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    // Start read-only sessions read-only (and time-limited) from their very first
    // statement. setReadOnly / setStatementTimeout re-sync clients at checkout.
    options: [config.readOnly ? '-c default_transaction_read_only=on' : '', `-c statement_timeout=${Math.max(0, Math.floor(config.statementTimeoutMs))}`].filter(Boolean).join(' ')
  }
}
