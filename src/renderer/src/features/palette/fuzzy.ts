/**
 * Small fuzzy matcher for the command palette. Every query character must
 * appear in order (subsequence). The score rewards contiguous runs, matches at
 * word starts (after `.`, `_`, `-`, space, or a camelCase hump) and an early
 * first match. Returns null for no match. Pure and tested.
 */
export interface FuzzyResult {
  score: number
  /** Indices of matched characters in the target, for highlighting. */
  positions: number[]
}

const BOUNDARY = /[\s._\-/:]/

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, positions: [] }
  const t = target.toLowerCase()
  const positions: number[] = []
  let score = 0
  let ti = 0
  let prev = -2

  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    const atStart = found === 0 || BOUNDARY.test(target[found - 1] ?? '') || (/[a-z]/.test(target[found - 1] ?? '') && /[A-Z]/.test(target[found] ?? ''))
    score += 1
    if (found === prev + 1) score += 5 // contiguous run
    if (atStart) score += 8
    positions.push(found)
    prev = found
    ti = found + 1
  }
  score -= (positions[0] ?? 0) * 0.2 // earlier first match is better
  score -= (target.length - q.length) * 0.05 // shorter targets win ties
  if (t === q) score += 50
  else if (t.startsWith(q)) score += 20
  return { score, positions }
}

/** Filters and ranks items by `text(item)`. Stable for equal scores. */
export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 50): Array<{ item: T; match: FuzzyResult }> {
  const out: Array<{ item: T; match: FuzzyResult; i: number }> = []
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, text(item))
    if (match) out.push({ item, match, i })
  })
  out.sort((a, b) => b.match.score - a.match.score || a.i - b.i)
  return out.slice(0, limit).map(({ item, match }) => ({ item, match }))
}
