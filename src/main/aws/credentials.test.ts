import { describe, expect, it, vi } from 'vitest'
import { memoizeCredentials } from './credentials'

describe('memoizeCredentials', () => {
  it('reuses credentials until 5 minutes before expiry', async () => {
    let t = 0
    const provider = vi.fn(async () => ({ accessKeyId: 'a', secretAccessKey: 's', expiration: new Date(60 * 60_000) }))
    const memo = memoizeCredentials(provider, () => t)
    await memo()
    t = 50 * 60_000
    await memo()
    expect(provider).toHaveBeenCalledTimes(1)
    t = 56 * 60_000
    await memo()
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent calls and does not cache failures', async () => {
    const provider = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 's' })
    const memo = memoizeCredentials(provider)
    await expect(Promise.all([memo(), memo()])).rejects.toThrow('boom')
    expect(provider).toHaveBeenCalledTimes(1)
    await expect(memo()).resolves.toMatchObject({ accessKeyId: 'a' })
  })

  it('invalidate() forces a fresh resolve', async () => {
    const provider = vi.fn(async () => ({ accessKeyId: 'a', secretAccessKey: 's' }))
    const memo = memoizeCredentials(provider)
    await memo()
    memo.invalidate()
    await memo()
    expect(provider).toHaveBeenCalledTimes(2)
  })
})
