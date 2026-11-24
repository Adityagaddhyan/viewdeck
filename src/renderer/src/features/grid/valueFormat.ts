/**
 * Display helpers for temporal values. Pure, unit-tested.
 * - `parsePgTimestamp` reads Postgres timestamp/timestamptz/date text
 *   ("2026-11-23 12:00:00.123456+05:30", "2026-11-23").
 * - `describeInstant` gives local / UTC / relative strings for hover tooltips.
 * - `formatEpoch` renders integer epoch columns (seconds or milliseconds),
 *   e.g. created_at int8 1771907103556 → "2026-02-24 04:25:03.556".
 */
export type ColumnFormat = 'epoch-ms' | 'epoch-s'

const TEMPORAL = /^(timestamp|timestamptz|date|timestamp with(out)? time zone)/i
export const isTemporalType = (dataType: string): boolean => TEMPORAL.test(dataType)
export const isIntegerType = (dataType: string): boolean => /^(int8|int4|bigint|integer|numeric)/i.test(dataType)

export function parsePgTimestamp(text: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?)?([+-]\d{2}(?::?\d{2})?|Z)?$/.exec(text.trim())
  if (!m) return null
  const [, date, time = '00:00:00', frac = '', tz] = m
  const ms = frac ? `.${frac.slice(1, 4).padEnd(3, '0')}` : ''
  const zone = tz === undefined ? '' : tz === 'Z' ? 'Z' : tz.length === 3 ? `${tz}:00` : tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`
  const d = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${ms}${zone}`)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** "2026-11-23 19:48:01.556" in the machine's local time zone. */
export function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${d.getMilliseconds() ? `.${pad(d.getMilliseconds(), 3)}` : ''}`
}

export function formatUtc(d: Date): string {
  return `${d.toISOString().replace('T', ' ').replace(/\.000Z$/, 'Z').replace(/\.(\d{3})Z$/, '.$1Z')}`
}

export function relativeTime(d: Date, now = Date.now()): string {
  const diff = d.getTime() - now
  const abs = Math.abs(diff)
  const units: Array<[number, string]> = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second']
  ]
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size)
      return diff < 0 ? `${n} ${name}${n === 1 ? '' : 's'} ago` : `in ${n} ${name}${n === 1 ? '' : 's'}`
    }
  }
  return 'just now'
}

/** Multi-line tooltip: local, UTC, relative. */
export function describeInstant(d: Date, now = Date.now()): string {
  return `Local: ${formatLocal(d)}\nUTC:   ${formatUtc(d)}\n${relativeTime(d, now)}`
}

/** Epoch number/text → Date, or null if it isn't a plausible epoch for the unit. */
export function epochToDate(v: string | number, unit: ColumnFormat): Date | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(unit === 'epoch-ms' ? n : n * 1000)
  return d.getFullYear() >= 1970 && d.getFullYear() <= 9999 ? d : null
}

/** Guesses whether an integer column holds epoch ms / s, from its name and a sample value. */
export function guessEpochFormat(name: string, sample: string | number | null): ColumnFormat | null {
  if (sample === null || !/(_at|_on|time|date|ts)$/i.test(name)) return null
  const digits = String(sample).replace(/^-/, '').length
  return digits === 13 ? 'epoch-ms' : digits === 10 ? 'epoch-s' : null
}
