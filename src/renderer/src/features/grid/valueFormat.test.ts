import { describe, expect, it } from 'vitest'
import { describeInstant, epochToDate, formatUtc, guessEpochFormat, isTemporalType, parsePgTimestamp, relativeTime } from './valueFormat'

describe('parsePgTimestamp', () => {
  it.each([
    ['2026-11-23 12:00:00.123456+00', '2026-11-23T12:00:00.123Z'],
    ['2026-11-23 17:30:00+05:30', '2026-11-23T12:00:00.000Z'],
    ['2026-11-23 12:00:00-0800', '2026-11-23T20:00:00.000Z'],
    ['2026-11-23T12:00:00Z', '2026-11-23T12:00:00.000Z']
  ])('%s', (text, iso) => {
    expect(parsePgTimestamp(text)?.toISOString()).toBe(iso)
  })
  it('rejects non-timestamps', () => {
    expect(parsePgTimestamp('hello')).toBeNull()
  })
})

describe('epoch handling', () => {
  it('converts ms and s epochs and rejects implausible ones', () => {
    expect(formatUtc(epochToDate('1771907103556', 'epoch-ms') as Date)).toBe('2026-02-24 04:25:03.556Z')
    expect(formatUtc(epochToDate(1771907103, 'epoch-s') as Date)).toBe('2026-02-24 04:25:03Z')
    expect(epochToDate('0', 'epoch-ms')).toBeNull()
    expect(epochToDate('abc', 'epoch-ms')).toBeNull()
  })
  it('guesses epoch columns from name + digits', () => {
    expect(guessEpochFormat('created_at', '1771907103556')).toBe('epoch-ms')
    expect(guessEpochFormat('updated_at', 1771907103)).toBe('epoch-s')
    expect(guessEpochFormat('deleted_at', '0')).toBeNull()
    expect(guessEpochFormat('amount', '1771907103556')).toBeNull()
  })
})

describe('relative / describe', () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  it('relative', () => {
    expect(relativeTime(new Date(now - 3 * 86_400_000), now)).toBe('3 days ago')
    expect(relativeTime(new Date(now + 2 * 3_600_000), now)).toBe('in 2 hours')
    expect(relativeTime(new Date(now), now)).toBe('just now')
  })
  it('describeInstant has local, UTC and relative lines', () => {
    const s = describeInstant(new Date(now - 60_000), now)
    expect(s.split('\n')).toHaveLength(3)
    expect(s).toContain('UTC:   2026-11-23 11:59:00Z')
    expect(s).toContain('1 minute ago')
  })
  it('isTemporalType', () => {
    expect(isTemporalType('timestamptz')).toBe(true)
    expect(isTemporalType('date')).toBe(true)
    expect(isTemporalType('int8')).toBe(false)
  })
})
