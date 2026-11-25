import { describe, expect, it } from 'vitest'
import { ancestorKeys, contains, jsonMatches, splitMatches, textMatches } from './valueSearch'

const doc = { customer: { name: 'Ada', tier: 'gold' }, items: [{ sku: 'SKU-1', qty: 2 }, { sku: 'sku-2', qty: null }], note: null }

describe('jsonMatches', () => {
  it('finds keys and scalar values, case-insensitively, in render order', () => {
    expect(jsonMatches(doc, 'sku')).toEqual([['items', 0, 'sku'], ['items', 1, 'sku']])
    expect(jsonMatches(doc, 'GOLD')).toEqual([['customer', 'tier']])
  })
  it('matches numbers and null as text', () => {
    expect(jsonMatches(doc, '2')).toEqual([['items', 0, 'qty'], ['items', 1, 'sku']])
    expect(jsonMatches(doc, 'null')).toEqual([['items', 1, 'qty'], ['note']])
  })
  it('does not match array indexes or empty queries', () => {
    expect(jsonMatches([5, 6], '0')).toEqual([])
    expect(jsonMatches(doc, '')).toEqual([])
  })
  it('matches a container by its key', () => {
    expect(jsonMatches(doc, 'items')).toEqual([['items']])
  })
})

describe('ancestorKeys', () => {
  it('lists every container above the matches, root included', () => {
    expect(ancestorKeys([['items', 0, 'sku']]).sort()).toEqual(['["items",0]', '["items"]', '[]'].sort())
    expect(ancestorKeys([[]])).toEqual([])
  })
})

describe('textMatches / splitMatches', () => {
  it('finds non-overlapping occurrences', () => {
    expect(textMatches('aaaa', 'aa')).toEqual([0, 2])
    expect(textMatches('Hello hello', 'HELLO')).toEqual([0, 6])
    expect(textMatches('abc', '')).toEqual([])
  })
  it('splits text into highlighted pieces with occurrence indexes', () => {
    expect(splitMatches('a-B-b', 'b')).toEqual([
      { text: 'a-', match: null },
      { text: 'B', match: 0 },
      { text: '-', match: null },
      { text: 'b', match: 1 }
    ])
    expect(splitMatches('xyz', 'q')).toEqual([{ text: 'xyz', match: null }])
  })
  it('contains is case-insensitive and false for an empty query', () => {
    expect(contains('Gold', 'gO')).toBe(true)
    expect(contains('Gold', '')).toBe(false)
  })
})
