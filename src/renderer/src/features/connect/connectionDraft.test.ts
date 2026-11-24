import { describe, expect, it } from 'vitest'
import type { RdsDatabase } from '@shared/types/aws'
import { awsDraftToRequest, defaultAwsDraft, detectedEnvironment, manualDraftToRequest, defaultManualDraft, validateAwsDraft } from './connectionDraft'

const db: RdsDatabase = {
  identifier: 'orders-prod',
  kind: 'instance',
  engine: 'postgres',
  engineVersion: '16.4',
  status: 'available',
  endpoint: 'orders-prod.abc.us-east-1.rds.amazonaws.com',
  readerEndpoint: null,
  port: 5432,
  publiclyAccessible: false,
  vpcId: 'vpc-1',
  iamAuthEnabled: true,
  databaseName: 'orders',
  masterUsername: 'postgres',
  region: 'us-east-1'
}

describe('connectionDraft', () => {
  it('defaults private DBs to an SSM tunnel and requires a host for it', () => {
    const d = defaultAwsDraft('acme', 'us-east-1', db)
    expect(d).toMatchObject({ authKind: 'rds-iam', database: 'orders', name: 'orders-prod', routeKind: 'ssm-tunnel' })
    expect(validateAwsDraft(d)).toMatch(/tunnel host/)
    expect(validateAwsDraft({ ...d, tunnelTargetId: 'i-abc' })).toBeNull()
  })

  it('private DB reached directly (VPN) needs no tunnel host and keeps verify-full IAM', () => {
    const d = { ...defaultAwsDraft('acme', 'us-east-1', db), routeKind: 'direct' as const, user: 'app_readonly' }
    expect(validateAwsDraft(d)).toBeNull()
    const req = awsDraftToRequest(d)
    expect(req.connection.route).toEqual({ kind: 'direct', host: db.endpoint, port: 5432 })
    expect(req.connection).toMatchObject({ tlsMode: 'verify-full', auth: { kind: 'rds-iam', user: 'app_readonly' } })
  })

  it('builds an ssm-tunnel route with verify-full TLS', () => {
    const req = awsDraftToRequest({ ...defaultAwsDraft('acme', 'us-east-1', db), tunnelTargetId: 'i-abc', user: 'app_ro' })
    expect(req.connection.route).toEqual({ kind: 'ssm-tunnel', targetInstanceId: 'i-abc', rdsHost: db.endpoint, rdsPort: 5432 })
    expect(req.connection).toMatchObject({ tlsMode: 'verify-full', auth: { kind: 'rds-iam', user: 'app_ro' }, aws: { profile: 'acme', rdsIdentifier: 'orders-prod' } })
    expect(req.password).toBeUndefined()
  })

  it('public DBs connect directly; password included only for password auth', () => {
    const d = { ...defaultAwsDraft('acme', 'us-east-1', { ...db, publiclyAccessible: true }), authKind: 'password' as const, password: 'pw' }
    const req = awsDraftToRequest(d)
    expect(req.connection.route).toEqual({ kind: 'direct', host: db.endpoint, port: 5432 })
    expect(req.password).toBe('pw')
  })

  it('remembers per-DB choices and the profile route for new private DBs', async () => {
    const { applyWizardMemory, wizardMemoryOf } = await import('./connectionDraft')
    const fresh = defaultAwsDraft('acme', 'us-east-1', db)
    const remembered = applyWizardMemory(fresh, { user: 'app_readonly', database: 'ordersdb', routeKind: 'direct', authKind: 'rds-iam' }, 'ssm-tunnel')
    expect(remembered).toMatchObject({ user: 'app_readonly', database: 'ordersdb', routeKind: 'direct' })
    expect(applyWizardMemory(fresh, null, 'direct').routeKind).toBe('direct') // profile habit for an unseen DB
    const pub = defaultAwsDraft('acme', 'us-east-1', { ...db, publiclyAccessible: true })
    expect(applyWizardMemory(pub, { routeKind: 'ssm-tunnel' }, 'ssm-tunnel').routeKind).toBe('direct')
    expect(wizardMemoryOf(remembered)).toMatchObject({ user: 'app_readonly', routeKind: 'direct' })
  })

  it('detects environment from names', () => {
    expect(detectedEnvironment(defaultAwsDraft('acme', 'us-east-1', db))).toBe('prod')
  })

  it('manual drafts are direct password connections', () => {
    const req = manualDraftToRequest({ ...defaultManualDraft, password: 'x' })
    expect(req.connection).toMatchObject({ route: { kind: 'direct', host: '127.0.0.1', port: 5432 }, aws: null, tlsMode: 'disable' })
  })
})
