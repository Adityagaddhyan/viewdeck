import { describe, expect, it } from 'vitest'
import { requirePort, requireString } from './validate'

describe('IPC validation', () => {
  it('rejects flag-like and malformed strings', () => {
    expect(() => requireString('--help', 'profile')).toThrow(/invalid/)
    expect(() => requireString('', 'profile')).toThrow(/non-empty/)
    expect(() => requireString(42, 'profile')).toThrow(/non-empty/)
    expect(() => requireString('i-zz', 'id', /^i-[0-9a-f]+$/)).toThrow(/invalid/)
    expect(requireString('acme-prod', 'profile')).toBe('acme-prod')
  })
  it('validates ports', () => {
    expect(requirePort(5432)).toBe(5432)
    expect(() => requirePort(0)).toThrow()
    expect(() => requirePort('5432')).toThrow()
  })
})
