import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'

describe('normalizeSettings', () => {
  it('defaults match the environment policy (prod/staging/unknown locked, dev open)', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.readOnlyDefaults).toEqual({ prod: true, staging: true, dev: false, unknown: true })
    expect(DEFAULT_SETTINGS.timeoutDefaults).toEqual({ prod: 30000, staging: 60000, dev: 0, unknown: 30000 })
  })
  it('keeps valid values and repairs bad ones', () => {
    const s = normalizeSettings({ pageSize: 5000, editorFontSize: 99, theme: 'neon', dateDisplay: 'utc', readOnlyDefaults: { dev: true, prod: 'yes' }, timeoutDefaults: { prod: -5, dev: 1500.7 }, extra: 1 })
    expect(s).toMatchObject({ pageSize: 5000, editorFontSize: 20, theme: 'dark', dateDisplay: 'utc' })
    expect(s.readOnlyDefaults).toEqual({ prod: true, staging: true, dev: true, unknown: true })
    expect(s.timeoutDefaults).toMatchObject({ prod: 30000, dev: 1500 })
    expect(s).not.toHaveProperty('extra')
  })
})
