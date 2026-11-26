import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: { showErrorBox: vi.fn() } }))
const { isNetworkError } = await import('./crashGuard')

describe('isNetworkError', () => {
  it('recognises dropped-socket errors by code', () => {
    expect(isNetworkError(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe(true)
    expect(isNetworkError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
  })
  it("recognises pg's connection-terminated errors", () => {
    expect(isNetworkError(new Error('Connection terminated unexpectedly'))).toBe(true)
  })
  it('leaves real bugs alone', () => {
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false)
    expect(isNetworkError(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(false)
    expect(isNetworkError('ETIMEDOUT')).toBe(false)
  })
})
