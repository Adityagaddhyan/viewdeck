import { describe, expect, it } from 'vitest'
import { completionContext, findTableRefs, quoteIfNeeded } from './completionContext'

describe('findTableRefs', () => {
  it('finds schema-qualified, aliased and quoted tables', () => {
    const refs = findTableRefs('select * from sales.Orders o join "Line Items" as li on li.oid = o.id where x left join users')
    expect(refs).toEqual([
      { schema: 'sales', table: 'orders', alias: 'o' },
      { schema: null, table: 'Line Items', alias: 'li' },
      { schema: null, table: 'users', alias: null }
    ])
  })
  it('does not treat keywords as aliases', () => {
    expect(findTableRefs('select * from orders where id = 1')[0]?.alias).toBeNull()
    expect(findTableRefs('update orders set a = 1')[0]).toEqual({ schema: null, table: 'orders', alias: null })
  })
})

describe('completionContext', () => {
  const stmt = 'select o. from public.orders o'
  it('detects dotted qualifiers', () => {
    expect(completionContext('select o.', stmt)).toMatchObject({ kind: 'dotted', qualifier: 'o' })
    expect(completionContext('select * from sales.ord', 'select * from sales.ord')).toMatchObject({ kind: 'dotted', qualifier: 'sales' })
  })
  it('falls back to general', () => {
    expect(completionContext('select ', stmt)).toMatchObject({ kind: 'general', refs: [{ table: 'orders', alias: 'o' }] })
  })
})

describe('quoteIfNeeded', () => {
  it('quotes only when required', () => {
    expect(quoteIfNeeded('orders')).toBe('orders')
    expect(quoteIfNeeded('Orders')).toBe('"Orders"')
    expect(quoteIfNeeded('line items')).toBe('"line items"')
  })
})
