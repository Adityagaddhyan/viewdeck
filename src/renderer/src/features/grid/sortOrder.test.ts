import { describe, expect, it } from 'vitest'
import { formatSort, nextSort, parseSort } from './sortOrder'

describe('sortOrder', () => {
  it('parses quoted and bare single-column ORDER BY', () => {
    expect(parseSort('"created_at" DESC')).toEqual({ column: 'created_at', dir: 'desc' })
    expect(parseSort('"My ""Col""" ASC')).toEqual({ column: 'My "Col"', dir: 'asc' })
    expect(parseSort('amount')).toEqual({ column: 'amount', dir: 'asc' })
    expect(parseSort('a desc, b')).toBeNull()
    expect(parseSort('')).toBeNull()
  })
  it('cycles none → asc → desc → none; other column restarts', () => {
    expect(nextSort(null, 'a')).toEqual({ column: 'a', dir: 'asc' })
    expect(nextSort({ column: 'a', dir: 'asc' }, 'a')).toEqual({ column: 'a', dir: 'desc' })
    expect(nextSort({ column: 'a', dir: 'desc' }, 'a')).toBeNull()
    expect(nextSort({ column: 'a', dir: 'desc' }, 'b')).toEqual({ column: 'b', dir: 'asc' })
  })
  it('formats back to quoted SQL', () => {
    expect(formatSort({ column: 'x', dir: 'desc' })).toBe('"x" DESC')
    expect(formatSort(null)).toBe('')
  })
})
