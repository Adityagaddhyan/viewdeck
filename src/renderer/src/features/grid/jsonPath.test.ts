import { describe, expect, it } from 'vitest'
import { containerPaths, jsonPath, pgAccessor } from './jsonPath'

describe('jsonPath', () => {
  it('builds dotted / bracketed paths', () => {
    expect(jsonPath([])).toBe('$')
    expect(jsonPath(['items', 0, 'sku'])).toBe('$.items[0].sku')
    expect(jsonPath(['weird key', 'a-b'])).toBe('$["weird key"]["a-b"]')
  })
})

describe('pgAccessor', () => {
  it('uses -> then ->> for the last step and escapes quotes', () => {
    expect(pgAccessor('payload', ['items', 0, 'sku'])).toBe(`"payload"->'items'->0->>'sku'`)
    expect(pgAccessor('meta', ["o'k"])).toBe(`"meta"->>'o''k'`)
    expect(pgAccessor('meta', [])).toBe('"meta"')
  })
})

describe('containerPaths', () => {
  it('lists containers down to depth', () => {
    const v = { a: { b: { c: 1 } }, arr: [{ x: 1 }] }
    expect(containerPaths(v, 1)).toEqual(['[]', '["a"]', '["arr"]'])
  })
})
