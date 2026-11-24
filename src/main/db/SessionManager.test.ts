import { describe, expect, it, vi } from 'vitest'
import type { SavedConnection } from '@shared/types/connection'
import type { DatabaseDriver, DriverConnectionConfig } from '@shared/types/driver'
import type { TunnelInfo } from '@shared/types/aws'
import { resolveConnection } from './resolveConnection'
import { SessionManager } from './SessionManager'

const RDS = 'orders.abc.us-east-1.rds.amazonaws.com'
const base: SavedConnection = {
  id: 'c1',
  name: 'orders',
  engine: 'postgres',
  database: 'orders',
  route: { kind: 'ssm-tunnel', targetInstanceId: 'i-abc', rdsHost: RDS, rdsPort: 5432 },
  auth: { kind: 'rds-iam', user: 'app_ro' },
  tlsMode: 'verify-full',
  aws: { profile: 'acme-prod', region: 'us-east-1', rdsIdentifier: 'orders' },
  environment: null,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: null
}
const tunnel = (over: Partial<TunnelInfo> = {}): TunnelInfo => ({
  id: 't1',
  state: 'ready',
  localHost: '127.0.0.1',
  localPort: 51000,
  remoteHost: RDS,
  remotePort: 5432,
  targetInstanceId: 'i-abc',
  profile: 'acme-prod',
  region: 'us-east-1',
  error: null,
  startedAt: '',
  ...over
})

function fakeDriver(connectImpl?: () => Promise<void>) {
  const seen: DriverConnectionConfig[] = []
  const driver = {
    engine: 'postgres',
    capabilities: { supportsSchemas: true, supportsTransactions: true, supportsReadOnlySession: true, supportsExplain: true, supportsCancel: true },
    setStatementTimeout: vi.fn(),
    connect: vi.fn(async (c: DriverConnectionConfig) => {
      seen.push(c)
      await connectImpl?.()
    }),
    disconnect: vi.fn(async () => {}),
    setReadOnly: vi.fn(async () => {}),
    executeQuery: vi.fn(async () => ({ fields: [], rows: [['16.4']], rowCount: 1, command: 'SHOW', durationMs: 1, truncated: false }))
  } as unknown as DatabaseDriver
  return { driver, seen }
}

describe('resolveConnection', () => {
  it('tunnel: socket 127.0.0.1, TLS + IAM signing use the real RDS host', async () => {
    const r = await resolveConnection(base, async () => tunnel())
    expect(r.config).toMatchObject({
      host: '127.0.0.1',
      port: 51000,
      tls: { mode: 'verify-full', servername: RDS, useRdsCaBundle: true },
      auth: { kind: 'rds-iam', rdsHost: RDS, rdsPort: 5432, awsProfile: 'acme-prod' },
      readOnly: true
    })
    expect(r.environment).toBe('prod')
  })

  it('direct local docker: no tunnel, dev → read-write', async () => {
    const open = vi.fn()
    const r = await resolveConnection(
      { ...base, name: 'local pg', route: { kind: 'direct', host: 'localhost', port: 5432 }, auth: { kind: 'password', user: 'postgres', secretRef: 's1' }, tlsMode: 'disable', aws: null },
      open
    )
    expect(open).not.toHaveBeenCalled()
    expect(r.config).toMatchObject({ host: 'localhost', readOnly: false, tls: { useRdsCaBundle: false } })
    expect(r.environment).toBe('dev')
  })

  it('settings override per-tier read-only and timeout defaults', async () => {
    const { DEFAULT_SETTINGS } = await import('@shared/settings')
    const settings = { ...DEFAULT_SETTINGS, readOnlyDefaults: { ...DEFAULT_SETTINGS.readOnlyDefaults, dev: true }, timeoutDefaults: { ...DEFAULT_SETTINGS.timeoutDefaults, dev: 5000 } }
    const local = { ...base, name: 'local pg', route: { kind: 'direct' as const, host: 'localhost', port: 5432 }, auth: { kind: 'password' as const, user: 'p', secretRef: 's' }, tlsMode: 'disable' as const, aws: null }
    const r = await resolveConnection(local, vi.fn(), settings)
    expect(r.config).toMatchObject({ readOnly: true, statementTimeoutMs: 5000 })
  })

  it('unknown environment defaults to read-only; manual override wins', async () => {
    const plain = { ...base, name: 'orders', aws: { profile: 'default', region: 'us-east-1', rdsIdentifier: 'orders' } }
    expect((await resolveConnection(plain, async () => tunnel())).config.readOnly).toBe(true)
    expect((await resolveConnection({ ...plain, environment: 'dev' }, async () => tunnel())).config.readOnly).toBe(false)
  })
})

describe('SessionManager', () => {
  it('connects through a tunnel and reports session info', async () => {
    const { driver } = fakeDriver()
    const mgr = new SessionManager({ createDriver: () => driver, openTunnel: async () => tunnel(), closeTunnel: vi.fn() })
    const s = await mgr.connect(base)
    expect(s).toMatchObject({ tunnelId: 't1', readOnly: true, environment: 'prod', serverVersion: '16.4', statementTimeoutMs: 30000, user: 'app_ro', host: RDS })
    expect(mgr.setStatementTimeout(s.id, 0).statementTimeoutMs).toBe(0)
    expect(driver.setStatementTimeout).toHaveBeenCalledWith(0)
    expect(mgr.list()).toHaveLength(1)
  })

  it('closes the tunnel if the driver fails to connect', async () => {
    const { driver } = fakeDriver(async () => {
      throw new Error('auth failed')
    })
    const closeTunnel = vi.fn(async () => {})
    const mgr = new SessionManager({ createDriver: () => driver, openTunnel: async () => tunnel(), closeTunnel })
    await expect(mgr.connect(base)).rejects.toThrow('auth failed')
    expect(closeTunnel).toHaveBeenCalledWith('t1')
    expect(mgr.list()).toEqual([])
  })

  it('ends the session and notifies when its tunnel dies', async () => {
    const { driver } = fakeDriver()
    const onSessionLost = vi.fn()
    const mgr = new SessionManager({ createDriver: () => driver, openTunnel: async () => tunnel(), closeTunnel: vi.fn(), onSessionLost })
    const s = await mgr.connect(base)
    mgr.handleTunnelStatus(tunnel({ state: 'failed', error: 'plugin exited' }))
    expect(onSessionLost).toHaveBeenCalledWith(s.id, 'plugin exited')
    expect(driver.disconnect).toHaveBeenCalled()
    expect(() => mgr.driver(s.id)).toThrow(/no longer connected/)
  })

  it('disconnect closes driver then tunnel', async () => {
    const { driver } = fakeDriver()
    const closeTunnel = vi.fn(async () => {})
    const mgr = new SessionManager({ createDriver: () => driver, openTunnel: async () => tunnel(), closeTunnel })
    const s = await mgr.connect(base)
    await mgr.disconnect(s.id)
    expect(driver.disconnect).toHaveBeenCalled()
    expect(closeTunnel).toHaveBeenCalledWith('t1')
  })
})
