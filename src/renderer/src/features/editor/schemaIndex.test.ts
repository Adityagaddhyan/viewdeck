import { describe, expect, it } from 'vitest'
import type { SchemaSnapshot } from '@shared/types/driver'
import { SchemaIndex } from './schemaIndex'

const snap: SchemaSnapshot = {
  schemas: ['public', 'billing', 'audit'],
  searchPath: ['billing', 'public'],
  tables: [
    { schema: 'public', name: 'orders', kind: 'table', columns: [['id', 'int4']] },
    { schema: 'billing', name: 'orders', kind: 'table', columns: [['id', 'bpchar'], ['created_at', 'int8']] },
    { schema: 'billing', name: 'Customer', kind: 'view', columns: [] },
    { schema: 'audit', name: 'log', kind: 'table', columns: [['at', 'timestamptz']] }
  ],
  truncated: false,
  takenAt: ''
}

describe('SchemaIndex', () => {
  const idx = new SchemaIndex(snap)
  it('resolves unqualified names through search_path order', () => {
    expect(idx.resolve(null, 'orders')?.schema).toBe('billing')
    expect(idx.resolve(null, 'log')?.schema).toBe('audit') // only one candidate anywhere
  })
  it('resolves qualified names, case-insensitively as a fallback', () => {
    expect(idx.resolve('public', 'orders')?.columns).toEqual([{ name: 'id', dataType: 'int4', ordinal: 1 }])
    expect(idx.resolve('BILLING', 'customer')?.name).toBe('Customer')
  })
  it('lists tables per schema and visible tables in search_path order', () => {
    expect(idx.tablesIn('billing').map((t) => t.name)).toEqual(['orders', 'Customer'])
    expect(idx.visibleTables().map((t) => `${t.schema}.${t.name}`)).toEqual(['billing.orders', 'billing.Customer', 'public.orders'])
    expect(idx.tableCount).toBe(4)
  })
})
