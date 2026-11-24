import { describe, expect, it } from 'vitest'
import { builderArch, isNewer, parseSha256Sums, parseVersion, zipAssetName } from './update'

describe('versions', () => {
  it('parses x.y.z with or without v and ignores suffixes', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.10.0-beta.1')).toEqual([0, 10, 0])
    expect(parseVersion('1.2')).toBeNull()
  })
  it('compares numerically, not as strings', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('garbage', '0.1.0')).toBe(false)
  })
})

describe('assets', () => {
  it('maps the CPU to electron-builder arch names and asset files', () => {
    expect(builderArch('arm64')).toBe('arm64')
    expect(builderArch('x64')).toBe('x64')
    expect(builderArch('ia32')).toBeNull()
    expect(zipAssetName('0.2.0', 'arm64')).toBe('ViewDeck-0.2.0-arm64-mac.zip')
  })
  it('parses shasum output (text and binary mode)', () => {
    const a = 'a'.repeat(64)
    const b = 'B'.repeat(64)
    const sums = parseSha256Sums(`${a}  ViewDeck-0.2.0-arm64-mac.zip\n${b} *ViewDeck-0.2.0-x64.dmg\nnot a line\n`)
    expect(sums.get('ViewDeck-0.2.0-arm64-mac.zip')).toBe(a)
    expect(sums.get('ViewDeck-0.2.0-x64.dmg')).toBe('b'.repeat(64))
    expect(sums.size).toBe(2)
  })
})
