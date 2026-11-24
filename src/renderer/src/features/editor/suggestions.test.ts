import { describe, expect, it } from 'vitest'
import { completionContext } from './completionContext'
import { SchemaIndex } from './schemaIndex'
import { filterSuggestions, sqlSuggestions } from './suggestions'

const idx = new SchemaIndex({
  schemas: ['public', 'billing'],
  searchPath: ['public'],
  tables: [
    { schema: 'billing', name: 'invoice_periods', kind: 'table', columns: [['id', 'bpchar'], ['created_at', 'int8']] },
    { schema: 'public', name: 'users', kind: 'table', columns: [['id', 'int4'], ['Email', 'text']] }
  ],
  truncated: false,
  takenAt: ''
})
const labels = (s: Array<{ label: string }>): string[] => s.map((x) => x.label)

describe('sqlSuggestions', () => {
  it('alias. → that table’s columns (schema-qualified FROM)', () => {
    const stmt = 'select ap. from billing.invoice_periods ap'
    expect(labels(sqlSuggestions(completionContext('select ap.', stmt), idx))).toEqual(['id', 'created_at'])
  })
  it('schema. → tables in that schema', () => {
    expect(labels(sqlSuggestions(completionContext('select * from billing.', 'select * from billing.'), idx))).toEqual(['invoice_periods'])
  })
  it('general → referenced columns first, then visible tables, schemas, functions, keywords; quotes mixed case', () => {
    const s = sqlSuggestions(completionContext('select ', 'select  from users'), idx)
    expect(labels(s).slice(0, 3)).toEqual(['id', 'Email', 'users'])
    expect(s.find((x) => x.label === 'Email')?.insertText).toBe('"Email"')
    expect(labels(s)).toContain('billing')
    expect(labels(s)).toContain('SELECT')
  })
  it('no index → keywords only', () => {
    expect(sqlSuggestions(completionContext('sel', 'sel'), null).every((x) => x.kind === 'keyword')).toBe(true)
  })
})

describe('filterSuggestions', () => {
  it('offers columns (typed), operators and functions', () => {
    const s = filterSuggestions([{ name: 'created_at', dataType: 'int8' }])
    expect(s[0]).toMatchObject({ label: 'created_at', kind: 'column', detail: 'int8' })
    expect(labels(s)).toEqual(expect.arrayContaining(['IS NULL', 'ILIKE', 'now()']))
  })
})
