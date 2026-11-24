import { describe, expect, it } from 'vitest'
import { normalizeSplit, paneOf } from './splitView'

const tabs = ['a', 'b', 'c']
const split = { left: 'a', right: 'b' }

describe('normalizeSplit', () => {
  it('keeps the split when focus moves between its panes', () => {
    expect(normalizeSplit(split, 'a', 'b', tabs)).toBe(split)
  })
  it('replaces the focused pane with a newly activated tab', () => {
    expect(normalizeSplit(split, 'b', 'c', tabs)).toEqual({ left: 'a', right: 'c' })
    expect(normalizeSplit(split, 'a', 'c', tabs)).toEqual({ left: 'c', right: 'b' })
  })
  it('ends the split when one of its tabs closes', () => {
    expect(normalizeSplit(split, 'b', 'a', ['a', 'c'])).toBeNull()
  })
  it('passes null through', () => {
    expect(normalizeSplit(null, 'a', 'b', tabs)).toBeNull()
  })
})

describe('paneOf', () => {
  it('locates tabs', () => {
    expect(paneOf(split, 'a')).toBe('left')
    expect(paneOf(split, 'b')).toBe('right')
    expect(paneOf(split, 'c')).toBeNull()
    expect(paneOf(null, 'a')).toBeNull()
  })
})
