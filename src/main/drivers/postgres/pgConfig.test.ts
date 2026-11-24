import { describe, expect, it } from 'vitest'
import type { DriverConnectionConfig } from '@shared/types/driver'
import { buildPoolConfig, buildTlsOptions } from './pgConfig'

const RDS = 'orders.abc.us-east-1.rds.amazonaws.com'
const CA = (): string => '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----'

const tunnelled: DriverConnectionConfig = {
  engine: 'postgres',
  host: '127.0.0.1',
  port: 51234,
  database: 'orders',
  auth: { kind: 'rds-iam', user: 'app_ro', awsProfile: 'p', region: 'us-east-1', rdsHost: RDS, rdsPort: 5432 },
  tls: { mode: 'verify-full', servername: RDS, useRdsCaBundle: true },
  readOnly: true,
  statementTimeoutMs: 30000
}

describe('buildTlsOptions', () => {
  it('verifies the real RDS hostname via servername over a localhost tunnel', () => {
    expect(buildTlsOptions(tunnelled, CA)).toEqual({ rejectUnauthorized: true, servername: RDS, ca: CA() })
  })

  it('infers servername from a DNS host on direct connections', () => {
    const direct = { ...tunnelled, host: RDS, tls: { mode: 'verify-full' as const, useRdsCaBundle: true } }
    expect(buildTlsOptions(direct, CA)).toMatchObject({ servername: RDS })
  })

  it('refuses verify-full to loopback without a servername', () => {
    expect(() => buildTlsOptions({ ...tunnelled, tls: { mode: 'verify-full' } }, CA)).toThrow(/real server hostname/)
  })

  it('refuses IAM auth without TLS', () => {
    expect(() => buildTlsOptions({ ...tunnelled, tls: { mode: 'disable' } }, CA)).toThrow(/requires TLS/)
  })

  it('allows plaintext for local password-auth Docker', () => {
    const local: DriverConnectionConfig = {
      ...tunnelled,
      auth: { kind: 'password', user: 'postgres', secretRef: 's' },
      tls: { mode: 'disable' }
    }
    expect(buildTlsOptions(local, CA)).toBe(false)
  })
})

describe('buildPoolConfig', () => {
  it('passes the password provider function through untouched (per-connection tokens)', () => {
    const provider = async (): Promise<string> => 'token'
    const cfg = buildPoolConfig({ config: tunnelled, password: provider, rdsCaBundle: CA })
    expect(cfg.password).toBe(provider)
    expect(cfg).toMatchObject({ host: '127.0.0.1', port: 51234, user: 'app_ro', database: 'orders' })
    expect(cfg.options).toBe('-c default_transaction_read_only=on -c statement_timeout=30000')
  })
})
