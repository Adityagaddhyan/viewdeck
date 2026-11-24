import { describe, expect, it } from 'vitest'
import { LocalStore, migrate } from './LocalStore'
import type { SafeStorageLike } from './SecretStore'

/** Reversible fake "encryption" so tests can prove plaintext never hits the table. */
const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
})

const sample = {
  name: 'orders (prod)',
  engine: 'postgres' as const,
  database: 'orders',
  route: { kind: 'ssm-tunnel' as const, targetInstanceId: 'i-abc', rdsHost: 'orders.x.rds.amazonaws.com', rdsPort: 5432 },
  auth: { kind: 'rds-iam' as const, user: 'app_ro' },
  tlsMode: 'verify-full' as const,
  aws: { profile: 'acme-prod', region: 'us-east-1', rdsIdentifier: 'orders' },
  environment: null
}

describe('LocalStore', () => {
  it('migrates idempotently', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage())
    expect(migrate(store.db)).toBe(2)
    store.close()
  })

  it('saves, updates, lists and deletes connections', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage())
    const saved = store.connections.save(sample)
    expect(saved).toMatchObject({ ...sample, lastUsedAt: null })
    store.connections.save({ ...saved, name: 'renamed' })
    store.connections.touch(saved.id)
    const [only] = store.connections.list()
    expect(only).toMatchObject({ id: saved.id, name: 'renamed', route: sample.route })
    expect(only?.lastUsedAt).not.toBeNull()
    store.connections.delete(saved.id)
    expect(store.connections.list()).toEqual([])
  })

  it('stores only ciphertext for secrets and round-trips them', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage())
    const ref = store.secrets.put('hunter2')
    const raw = store.db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Uint8Array }
    expect(Buffer.from(raw.ciphertext).toString()).not.toContain('hunter2')
    expect(store.secrets.get(ref)).toBe('hunter2')
    store.secrets.put('new-pass', ref)
    expect(store.secrets.get(ref)).toBe('new-pass')
  })

  it('refuses to store secrets without OS encryption', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage(false))
    expect(() => store.secrets.put('x')).toThrow(/secure storage is unavailable/)
  })

  it('saves, lists (connection + global), renames and deletes starred queries', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage())
    const a = store.savedQueries.save({ connectionId: 'c1', name: 'open periods', sql: 'select 1' })
    store.savedQueries.save({ connectionId: null, name: 'Global check', sql: 'select now()' })
    store.savedQueries.save({ connectionId: 'c2', name: 'other conn', sql: 'select 2' })
    expect(store.savedQueries.list('c1').map((q) => q.name)).toEqual(['Global check', 'open periods'])
    store.savedQueries.save({ ...a, name: 'Open periods (renamed)' })
    expect(store.savedQueries.list('c1').find((q) => q.id === a.id)?.name).toBe('Open periods (renamed)')
    store.savedQueries.delete(a.id)
    expect(store.savedQueries.list('c1').map((q) => q.name)).toEqual(['Global check'])
  })

  it('records and prunes query history; stores preferences', () => {
    const store = new LocalStore(':memory:', fakeSafeStorage())
    for (let i = 0; i < 3; i++) {
      store.history.add({ connectionId: 'c1', sql: `select ${i}`, durationMs: 1, rowCount: 1, error: null })
    }
    store.history.add({ connectionId: null, sql: 'select x', durationMs: null, rowCount: null, error: 'boom' })
    expect(store.history.list('c1').map((h) => h.sql)).toEqual(['select 2', 'select 1', 'select 0'])
    expect(store.history.list(null)).toHaveLength(1)

    store.preferences.set('lastProfile', { name: 'acme-prod', region: 'us-east-1' })
    expect(store.preferences.get('lastProfile')).toEqual({ name: 'acme-prod', region: 'us-east-1' })
    expect(store.preferences.get('missing')).toBeNull()
  })
})
