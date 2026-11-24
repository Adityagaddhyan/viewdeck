import { describe, expect, it } from 'vitest'
import type { SavedConnection } from '@shared/types/connection'
import { connectionEnvironment, editDraftToRequest, savedToEditDraft, validateEditDraft } from './editDraft'

const iam: SavedConnection = {
  id: 'c1',
  name: 'acme-orders-db-replica-1',
  engine: 'postgres',
  database: 'ordersdb',
  route: { kind: 'direct', host: 'x.rds.amazonaws.com', port: 5432 },
  auth: { kind: 'rds-iam', user: 'db_admin' },
  tlsMode: 'verify-full',
  aws: { profile: 'acme-prod-read', region: 'us-east-1', rdsIdentifier: 'acme-orders-db-replica-1' },
  environment: null,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: null
}

describe('editDraft', () => {
  it('round-trips a connection, e.g. fixing the IAM user', () => {
    const d = { ...savedToEditDraft(iam), user: 'app_readonly' }
    expect(validateEditDraft(d)).toBeNull()
    expect(editDraftToRequest(d)).toEqual({
      connection: { ...iam, auth: { kind: 'rds-iam', user: 'app_readonly' }, createdAt: undefined, updatedAt: undefined, lastUsedAt: undefined }
    } as never)
  })

  it('switching to an SSM tunnel needs a valid instance id', () => {
    const d = { ...savedToEditDraft(iam), routeKind: 'ssm-tunnel' as const }
    expect(validateEditDraft(d)).toMatch(/instance id/)
    const ok = { ...d, targetInstanceId: 'i-0abc123' }
    expect(editDraftToRequest(ok).connection.route).toEqual({ kind: 'ssm-tunnel', targetInstanceId: 'i-0abc123', rdsHost: 'x.rds.amazonaws.com', rdsPort: 5432 })
  })

  it('password: blank keeps the saved secret; required when none saved', () => {
    const pw: SavedConnection = { ...iam, auth: { kind: 'password', user: 'postgres', secretRef: 'secret:1' }, aws: null }
    const d = savedToEditDraft(pw)
    expect(d.hasSavedPassword).toBe(true)
    expect(validateEditDraft(d)).toBeNull()
    expect(editDraftToRequest(d).password).toBeUndefined()
    expect(validateEditDraft({ ...d, hasSavedPassword: false })).toMatch(/password/)
  })

  it('IAM without TLS or AWS profile is rejected', () => {
    expect(validateEditDraft({ ...savedToEditDraft(iam), tlsMode: 'disable' })).toMatch(/TLS/)
    expect(validateEditDraft({ ...savedToEditDraft(iam), awsProfile: '' })).toMatch(/AWS profile/)
  })

  it('connectionEnvironment uses override, else heuristics', () => {
    expect(connectionEnvironment(iam)).toBe('prod')
    expect(connectionEnvironment({ ...iam, environment: 'dev' })).toBe('dev')
  })
})
