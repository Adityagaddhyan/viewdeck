import { describe, expect, it } from 'vitest'
import { mergeSmallClusters } from './clusterMerge'

const adjOf = (edges: Array<[string, string]>): Map<string, Map<string, number>> => {
  const m = new Map<string, Map<string, number>>()
  for (const [a, b] of edges) {
    if (!m.has(a)) m.set(a, new Map())
    if (!m.has(b)) m.set(b, new Map())
    m.get(a)!.set(b, (m.get(a)!.get(b) ?? 0) + 1)
    m.get(b)!.set(a, (m.get(b)!.get(a) ?? 0) + 1)
  }
  return m
}

describe('mergeSmallClusters', () => {
  it('folds tiny clusters into the neighbour they share most edges with', () => {
    const adj = adjOf([['hub', 'a'], ['hub', 'b'], ['hub', 'c'], ['hub', 'd'], ['e', 'hub'], ['e', 'f'], ['x', 'y'], ['y', 'z'], ['z', 'w'], ['w', 'x'], ['f', 'x']])
    const out = mergeSmallClusters([['hub', 'a', 'b', 'c', 'd'], ['e', 'f'], ['w', 'x', 'y', 'z']], adj)
    expect(out).toEqual([['a', 'b', 'c', 'd', 'e', 'f', 'hub'], ['w', 'x', 'y', 'z']])
  })
  it('leaves big clusters and unconnected small ones alone', () => {
    const adj = adjOf([['a', 'b'], ['c', 'd'], ['c', 'e'], ['c', 'f']])
    expect(mergeSmallClusters([['a', 'b'], ['c', 'd', 'e', 'f']], adj)).toEqual([['a', 'b'], ['c', 'd', 'e', 'f']])
  })
})
