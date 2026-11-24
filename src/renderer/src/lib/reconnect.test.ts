import { describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@shared/types/connection'
import { BACKOFF_MS, reconnectWithBackoff } from './reconnect'

const fakeSession = { id: 's2' } as SessionInfo

describe('reconnectWithBackoff', () => {
  it('retries with backoff until connect succeeds', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('tunnel')).mockResolvedValue(fakeSession)
    const attempts: number[] = []
    const waits: number[] = []
    const out = await reconnectWithBackoff(connect, (a) => attempts.push(a), async (ms) => void waits.push(ms))
    expect(out).toBe(fakeSession)
    expect(attempts).toEqual([1, 2])
    expect(waits).toEqual(BACKOFF_MS.slice(0, 2))
  })
  it('gives up after the last backoff', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('down'))
    expect(await reconnectWithBackoff(connect, () => {}, async () => {})).toBeNull()
    expect(connect).toHaveBeenCalledTimes(BACKOFF_MS.length)
  })
  it('stops when cancelled (user switched connection)', async () => {
    const connect = vi.fn()
    expect(await reconnectWithBackoff(connect, () => {}, async () => {}, () => true)).toBeNull()
    expect(connect).not.toHaveBeenCalled()
  })
})
