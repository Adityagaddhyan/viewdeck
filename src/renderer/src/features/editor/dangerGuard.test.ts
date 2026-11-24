import { describe, expect, it } from 'vitest'
import { blankLiterals, findDangers } from './dangerGuard'

const reasons = (sql: string): string[] => findDangers(sql).map((d) => d.reason)

describe('findDangers', () => {
  it.each([
    ['update orders set status = 1', 'UPDATE without WHERE changes every row'],
    ['DELETE FROM orders', 'DELETE without WHERE removes every row'],
    ['with x as (select 1) delete from orders', 'DELETE without WHERE removes every row'],
    ['truncate orders', 'TRUNCATE removes every row'],
    ['drop table orders', 'DROP permanently removes an object'],
    ['alter table orders drop column notes', 'ALTER TABLE … DROP removes a column or constraint']
  ])('%s', (sql, reason) => {
    expect(reasons(sql)).toEqual([reason])
  })

  it('keyed statements and reads are fine', () => {
    expect(reasons("update orders set status = 'x' where id = 1")).toEqual([])
    expect(reasons('delete from orders where id in (1,2)')).toEqual([])
    expect(reasons('select * from orders')).toEqual([])
    expect(reasons('alter table orders add column x int')).toEqual([])
  })

  it('WHERE hidden in a comment or string does not count', () => {
    expect(reasons("update orders set note = 'where' -- where id = 1")).toHaveLength(1)
  })

  it('DROP inside a function body is ignored; multiple statements each checked', () => {
    expect(reasons('create function f() returns void as $$ drop table x; $$ language sql')).toEqual([])
    expect(reasons('select 1; delete from a; update b set c = 1 where d = 2')).toEqual(['DELETE without WHERE removes every row'])
  })

  it('blankLiterals preserves length', () => {
    const sql = "select 'a;b', \"q\" -- c\n/* d */ $$x$$"
    expect(blankLiterals(sql)).toHaveLength(sql.length)
  })
})
