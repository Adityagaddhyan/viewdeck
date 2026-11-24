import { describe, expect, it, vi } from 'vitest'
import { RdsIamSignerService } from './RdsIamSignerService'

const PARAMS = {
  profile: 'acme-prod',
  region: 'us-east-1',
  hostname: 'orders.abc.us-east-1.rds.amazonaws.com',
  port: 5432,
  username: 'app_ro'
}
const creds = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'sess' })

describe('RdsIamSignerService', () => {
  it('signs a fresh token on every provider call (never cached)', async () => {
    let n = 0
    const factory = vi.fn(() => ({ getAuthToken: async () => `token-${++n}` }))
    const svc = new RdsIamSignerService(() => creds, factory)
    const password = svc.createPasswordProvider(PARAMS)
    expect(await password()).toBe('token-1')
    expect(await password()).toBe('token-2')
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ hostname: PARAMS.hostname, port: 5432 }))
  })

  it('refuses to sign for a localhost tunnel address', () => {
    const svc = new RdsIamSignerService(() => creds)
    expect(() => svc.createPasswordProvider({ ...PARAMS, hostname: '127.0.0.1' })).toThrow(/real RDS endpoint/)
  })

  it('produces a real SigV4 token for the RDS endpoint with the real SDK signer', async () => {
    const svc = new RdsIamSignerService(() => creds)
    const token = await svc.getAuthToken(PARAMS)
    expect(token.startsWith('orders.abc.us-east-1.rds.amazonaws.com:5432/?')).toBe(true)
    expect(token).toContain('Action=connect')
    expect(token).toContain('DBUser=app_ro')
    expect(token).toContain('X-Amz-Expires=900')
  })

  it('maps credential failures to AppErrors', async () => {
    const svc = new RdsIamSignerService(() => creds, () => ({
      getAuthToken: async () => {
        throw Object.assign(new Error('The SSO session associated with this profile has expired'), { name: 'CredentialsProviderError' })
      }
    }))
    await expect(svc.getAuthToken(PARAMS)).rejects.toMatchObject({ appError: { code: 'AWS_SSO_EXPIRED' } })
  })
})
