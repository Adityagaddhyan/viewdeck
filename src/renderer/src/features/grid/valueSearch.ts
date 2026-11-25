/**
 * Find-in-value for the cell inspector (ValueViewer). Pure, unit-tested.
 * Matching is a case-insensitive substring test. In the JSON tree, a node matches
 * when its key or its scalar value contains the query. Matches come back in the
 * same order the tree renders them, so Enter / Shift+Enter step through them top to bottom.
 */
import type { JsonKey } from './jsonPath'

/** Case-insensitive "contains". Empty query never matches. */
export function contains(text: string, query: string): boolean {
  return query !== '' && text.toLowerCase().includes(query.toLowerCase())
}

/** Paths of every JSON node whose key or scalar value contains `query`, in render order. */
export function jsonMatches(value: unknown, query: string): JsonKey[][] {
  const out: JsonKey[][] = []
  if (query === '') return out
  const walk = (v: unknown, key: JsonKey | null, path: JsonKey[]): void => {
    const isObj = v !== null && typeof v === 'object'
    const keyHit = typeof key === 'string' && contains(key, query)
    const valueHit = !isObj && contains(v === null ? 'null' : String(v), query)
    if (keyHit || valueHit) out.push(path)
    if (!isObj) return
    const entries: Array<[JsonKey, unknown]> = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as object)
    for (const [k, child] of entries) walk(child, k, [...path, k])
  }
  walk(value, null, [])
  return out
}

/** Path keys (JSON-encoded, like JsonTree's `expanded`) of every container above the given paths. */
export function ancestorKeys(paths: JsonKey[][]): string[] {
  const keys = new Set<string>()
  for (const p of paths) for (let i = 0; i < p.length; i++) keys.add(JSON.stringify(p.slice(0, i)))
  return [...keys]
}

/** Start offsets of every non-overlapping, case-insensitive occurrence of `query` in `text`. */
export function textMatches(text: string, query: string): number[] {
  if (query === '') return []
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  // toLowerCase can change length for a few characters; then offsets would drift, so match exactly.
  const [h, n] = hay.length === text.length && needle.length === query.length ? [hay, needle] : [text, query]
  const out: number[] = []
  for (let i = h.indexOf(n); i !== -1; i = h.indexOf(n, i + n.length)) out.push(i)
  return out
}

/** One piece of highlighted text; `match` is the occurrence index within this text, or null. */
export interface Segment {
  text: string
  match: number | null
}

/** Splits `text` into plain and matching segments for highlighting. */
export function splitMatches(text: string, query: string): Segment[] {
  const starts = textMatches(text, query)
  if (starts.length === 0) return [{ text, match: null }]
  const segs: Segment[] = []
  let at = 0
  starts.forEach((s, i) => {
    if (s > at) segs.push({ text: text.slice(at, s), match: null })
    segs.push({ text: text.slice(s, s + query.length), match: i })
    at = s + query.length
  })
  if (at < text.length) segs.push({ text: text.slice(at), match: null })
  return segs
}
