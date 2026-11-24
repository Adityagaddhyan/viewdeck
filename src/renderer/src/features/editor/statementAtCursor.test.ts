import { describe, expect, it } from 'vitest'
import { splitStatements, statementAtCursor } from './statementAtCursor'

describe('splitStatements', () => {
  it('splits on top-level semicolons only', () => {
    const sql = `select 'a;b', "c;d" from t; -- x;y
select 1 /* ; /* nested ; */ */;
create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql;
select $1, E'it\\'s;' ;
do $$ begin perform 1; end $$`
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      `select 'a;b', "c;d" from t`,
      `-- x;y\nselect 1 /* ; /* nested ; */ */`,
      'create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql',
      "select $1, E'it\\'s;'",
      'do $$ begin perform 1; end $$'
    ])
  })

  it("handles '' escapes and ignores empty statements", () => {
    expect(splitStatements(";; select 'it''s; fine';  ;").map((s) => s.text)).toEqual(["select 'it''s; fine'"])
  })
})

describe('statementAtCursor', () => {
  const sql = 'select 1;\n\nselect 2;\nselect 3'
  it('finds the statement under the cursor', () => {
    expect(statementAtCursor(sql, 2)?.text).toBe('select 1')
    expect(statementAtCursor(sql, sql.indexOf('2'))?.text).toBe('select 2')
    expect(statementAtCursor(sql, sql.length)?.text).toBe('select 3')
  })
  it('prefers the previous statement when the cursor is just after ; or in blank lines', () => {
    expect(statementAtCursor(sql, sql.indexOf(';') + 1)?.text).toBe('select 1')
    expect(statementAtCursor(sql, sql.indexOf('\n\n') + 1)?.text).toBe('select 1')
  })
  it('returns null for empty input', () => {
    expect(statementAtCursor('  -- only a comment\n', 3)).toBeNull()
  })
})
