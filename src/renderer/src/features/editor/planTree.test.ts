import { describe, expect, it } from 'vitest'
import { formatMs, misestimate, parsePlan } from './planTree'

const analyzed = [
  {
    Plan: {
      'Node Type': 'Hash Join',
      'Join Type': 'Inner',
      'Startup Cost': 1,
      'Total Cost': 50,
      'Plan Rows': 100,
      'Actual Total Time': 10,
      'Actual Rows': 100,
      'Actual Loops': 1,
      'Hash Cond': '(o.customer_id = c.id)',
      Plans: [
        {
          'Node Type': 'Seq Scan',
          'Relation Name': 'orders',
          Schema: 'public',
          Alias: 'o',
          'Startup Cost': 0,
          'Total Cost': 30,
          'Plan Rows': 10,
          'Actual Total Time': 6,
          'Actual Rows': 1000,
          'Actual Loops': 1,
          Filter: '(total > 0)'
        },
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'customers',
          'Index Name': 'customers_pkey',
          'Startup Cost': 0,
          'Total Cost': 8,
          'Plan Rows': 1,
          'Actual Total Time': 0.5,
          'Actual Rows': 1,
          'Actual Loops': 4
        }
      ]
    },
    'Planning Time': 0.2,
    'Execution Time': 10.4
  }
]

describe('parsePlan', () => {
  it('flattens in pre-order with depth, targets and details', () => {
    const p = parsePlan(analyzed)
    expect(p.analyzed).toBe(true)
    expect(p.nodes.map((n) => [n.depth, n.nodeType])).toEqual([
      [0, 'Hash Join'],
      [1, 'Seq Scan'],
      [1, 'Index Scan']
    ])
    expect(p.nodes[0]?.target).toBe('Inner join')
    expect(p.nodes[1]?.target).toBe('on public.orders o')
    expect(p.nodes[2]?.target).toBe('on customers using customers_pkey')
    expect(p.nodes[0]?.details).toEqual([['Hash Cond', '(o.customer_id = c.id)']])
    expect(p.planningMs).toBe(0.2)
    expect(p.executionMs).toBe(10.4)
  })

  it('computes self time across loops and misestimates', () => {
    const p = parsePlan(analyzed)
    expect(p.nodes[2]?.actualTotalMs).toBe(2) // 0.5 ms × 4 loops
    expect(p.nodes[0]?.selfMs).toBe(2) // 10 − 6 − 2
    expect(p.nodes[1]?.misestimate).toBe(100) // planned 10, got 1000
    expect(p.maxWeight).toBe(6)
  })

  it('handles plain EXPLAIN (costs only)', () => {
    const p = parsePlan([{ Plan: { 'Node Type': 'Result', 'Startup Cost': 0, 'Total Cost': 0.01, 'Plan Rows': 1 } }])
    expect(p.analyzed).toBe(false)
    expect(p.nodes[0]?.selfMs).toBeNull()
    expect(p.nodes[0]?.misestimate).toBeNull()
    expect(p.maxWeight).toBe(0.01)
  })

  it('rejects unknown shapes', () => {
    expect(() => parsePlan({ nope: 1 })).toThrow(/Unrecognised/)
  })
})

describe('helpers', () => {
  it('misestimate is symmetric and treats 0 rows as 1', () => {
    expect(misestimate(10, 1)).toBe(10)
    expect(misestimate(1, 10)).toBe(10)
    expect(misestimate(5, 0)).toBe(5)
  })
  it('formatMs', () => {
    expect(formatMs(0.0123)).toBe('0.012 ms')
    expect(formatMs(4.33)).toBe('4.3 ms')
    expect(formatMs(42.4)).toBe('42 ms')
    expect(formatMs(1240)).toBe('1.24 s')
  })
})
