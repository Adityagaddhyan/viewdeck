import { describe, expect, it } from 'vitest'
import { buildChangesetStatements, quoteIdent } from './changesetSql'

describe('quoteIdent', () => {
  it('quotes and escapes', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('My "Weird" Col')).toBe('"My ""Weird"" Col"')
    expect(() => quoteIdent('')).toThrow()
  })
})

describe('buildChangesetStatements', () => {
  it('builds parameterised update/insert/delete with deletes last', () => {
    const hostile = "o'clock; drop table x"
    const stmts = buildChangesetStatements({
      schema: 'public',
      table: 'Orders',
      changes: [
        { kind: 'delete', key: { id: 9 } },
        { kind: 'update', key: { id: 1, tenant: 'a' }, values: { status: 'paid', note: null } },
        { kind: 'insert', values: { id: 10, status: hostile } },
        { kind: 'insert', values: {} }
      ]
    })
    expect(stmts).toEqual([
      {
        sql: 'UPDATE "public"."Orders" SET "status" = $1, "note" = $2 WHERE "id" = $3 AND "tenant" = $4',
        params: ['paid', null, 1, 'a'],
        expectRows: 1
      },
      {
        sql: 'INSERT INTO "public"."Orders" ("id", "status") VALUES ($1, $2)',
        params: [10, hostile],
        expectRows: 1
      },
      { sql: 'INSERT INTO "public"."Orders" DEFAULT VALUES', params: [], expectRows: 1 },
      { sql: 'DELETE FROM "public"."Orders" WHERE "id" = $1', params: [9], expectRows: 1 }
    ])
  })

  it('refuses keyless updates and deletes', () => {
    expect(() =>
      buildChangesetStatements({ schema: 's', table: 't', changes: [{ kind: 'delete', key: {} }] })
    ).toThrow(/primary key/)
  })
})
