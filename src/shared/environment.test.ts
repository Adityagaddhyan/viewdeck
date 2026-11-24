import { describe, expect, it } from 'vitest'
import { classifyEnvironment, defaultReadOnly } from './environment'

describe('classifyEnvironment', () => {
  it.each([
    ['acme-prod', 'prod'],
    ['production', 'prod'],
    ['acme-staging', 'staging'],
    ['stage-admin', 'staging'],
    ['preprod', 'staging'],
    ['dev', 'dev'],
    ['local', 'dev'],
    ['default', 'unknown'],
    ['product-analytics', 'unknown']
  ] as const)('%s → %s', (name, tier) => {
    expect(classifyEnvironment(name)).toBe(tier)
  })

  it('picks the most cautious match across hints', () => {
    expect(classifyEnvironment('dev-profile', 'prod-db')).toBe('prod')
  })
})

describe('defaultStatementTimeoutMs', () => {
  it('limits prod/unknown to 30s, staging 60s, dev off', async () => {
    const { defaultStatementTimeoutMs } = await import('./environment')
    expect([defaultStatementTimeoutMs('prod'), defaultStatementTimeoutMs('unknown'), defaultStatementTimeoutMs('staging'), defaultStatementTimeoutMs('dev')]).toEqual([30000, 30000, 60000, 0])
  })
})

describe('defaultReadOnly', () => {
  it('locks everything except dev', () => {
    expect(defaultReadOnly('prod')).toBe(true)
    expect(defaultReadOnly('staging')).toBe(true)
    expect(defaultReadOnly('unknown')).toBe(true)
    expect(defaultReadOnly('dev')).toBe(false)
  })
})

describe('classifyEnvironment (multi-hint)', () => {
  it('prod beats staging regardless of order', () => {
    expect(classifyEnvironment('acme-staging', 'acme-prod')).toBe('prod')
  })
})
