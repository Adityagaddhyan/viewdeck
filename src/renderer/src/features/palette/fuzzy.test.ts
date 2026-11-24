import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('requires an in-order subsequence', () => {
    expect(fuzzyMatch('ord', 'public.orders')).not.toBeNull()
    expect(fuzzyMatch('dro', 'public.orders')).toBeNull()
  })
  it('returns match positions', () => {
    expect(fuzzyMatch('po', 'public.orders')?.positions).toEqual([0, 7])
  })
  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('  ', 'x')).toEqual({ score: 0, positions: [] })
  })
})

describe('fuzzyFilter ranking', () => {
  const tables = ['public.order_items', 'public.orders', 'audit.user_orders_log', 'public.customers']
  it('prefers word-start + contiguous matches', () => {
    expect(fuzzyFilter(tables, 'orders', (t) => t).map((r) => r.item)[0]).toBe('public.orders')
  })
  it('matches initials across word boundaries', () => {
    expect(fuzzyFilter(tables, 'oi', (t) => t)[0]?.item).toBe('public.order_items')
  })
  it('keeps input order for equal scores and respects limit', () => {
    expect(fuzzyFilter(['a1', 'a2', 'a3'], '', (t) => t, 2).map((r) => r.item)).toEqual(['a1', 'a2'])
  })
})
