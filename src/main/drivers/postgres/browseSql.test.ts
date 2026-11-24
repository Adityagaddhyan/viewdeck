import { describe, expect, it } from 'vitest'
import { buildBrowseSql, buildCountSql } from './browseSql'

const base = { schema: 'billing', table: 'invoice_periods', primaryKey: ['id'] }

describe('buildCountSql', () => {
  it('counts with the contained filter', () => {
    expect(buildCountSql({ schema: 's', table: 't' })).toBe('SELECT count(*)::text AS n FROM "s"."t" LIMIT $1')
    expect(buildCountSql({ schema: 's', table: 't', where: 'a = 1 -- c' })).toBe('SELECT count(*)::text AS n FROM "s"."t"\nWHERE (\na = 1 -- c\n) LIMIT $1')
  })
})

describe('buildBrowseSql', () => {
  it('defaults to primary-key order with no filter', () => {
    expect(buildBrowseSql(base)).toBe('SELECT * FROM "billing"."invoice_periods" ORDER BY "id" LIMIT $1 OFFSET $2')
  })

  it('wraps the filter in parentheses on its own lines (comments and OR stay contained)', () => {
    const sql = buildBrowseSql({ ...base, where: "status = 'OPEN' or customer_id = 'x' -- note" })
    expect(sql).toBe(
      `SELECT * FROM "billing"."invoice_periods"\nWHERE (\nstatus = 'OPEN' or customer_id = 'x' -- note\n) ORDER BY "id" LIMIT $1 OFFSET $2`
    )
  })

  it('user ORDER BY replaces the PK order; whitespace-only fragments are ignored', () => {
    expect(buildBrowseSql({ ...base, where: '  ', orderBy: 'start_date desc' })).toBe(
      'SELECT * FROM "billing"."invoice_periods"\nORDER BY start_date desc\n LIMIT $1 OFFSET $2'
    )
  })

  it('no PK and no sort → unordered', () => {
    expect(buildBrowseSql({ ...base, primaryKey: [] })).toBe('SELECT * FROM "billing"."invoice_periods" LIMIT $1 OFFSET $2')
  })
})
