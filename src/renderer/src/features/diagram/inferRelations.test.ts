import { describe, expect, it } from 'vitest'
import type { GraphColumn, GraphForeignKey, GraphTable, SchemaGraph } from '@shared/types/diagram'
import { inferRelationships, nameVariants, referenceStem, typeMatch } from './inferRelations'

const col = (name: string, dataType = 'int8', nullable = false): GraphColumn => ({ name, dataType, nullable, comment: null })

function table(name: string, columns: GraphColumn[], opts: Partial<GraphTable> = {}): GraphTable {
  return {
    schema: 'public', name, kind: 'table', external: false, columns, primaryKey: ['id'], uniqueKeys: [],
    rowEstimate: null, totalBytes: null, comment: null, ...opts
  }
}

const graph = (tables: GraphTable[], foreignKeys: GraphForeignKey[] = []): SchemaGraph => ({ schema: 'public', tables, foreignKeys, fetchedAt: '' })

const pairs = (g: SchemaGraph): string[] => inferRelationships(g).map((e) => `${e.from}.${e.fromColumns[0]}->${e.to}.${e.toColumns[0]}:${e.confidence}`)

describe('name helpers', () => {
  it('extracts stems only from _id and camelCase Id', () => {
    expect(referenceStem('customer_id')).toBe('customer')
    expect(referenceStem('Customer_ID')).toBe('customer')
    expect(referenceStem('orderId')).toBe('order')
    expect(referenceStem('lineItemId')).toBe('line_item')
    expect(referenceStem('paid')).toBeNull()
    expect(referenceStem('valid')).toBeNull()
    expect(referenceStem('customerid')).toBeNull()
    expect(referenceStem('id')).toBeNull()
  })

  it('builds plural / singular variants', () => {
    expect(nameVariants('category')).toContain('categories')
    expect(nameVariants('box')).toContain('boxes')
    expect(nameVariants('people')).toContain('people')
  })

  it('classifies type compatibility', () => {
    expect(typeMatch('integer', 'int4')).toBe('high')
    expect(typeMatch('int4', 'int8')).toBe('medium')
    expect(typeMatch('character varying(40)', 'text')).toBe('medium')
    expect(typeMatch('numeric', 'bigint')).toBe('medium')
    expect(typeMatch('text', 'int8')).toBeNull()
    expect(typeMatch('uuid', 'text')).toBeNull()
  })
})

describe('inferRelationships', () => {
  it('finds positive matches with confidence, reason, shape and stable ids', () => {
    const g = graph([
      table('customers', [col('id')]),
      table('orders', [col('id', 'int4'), col('customer_id'), col('category_id', 'int8', true)]),
      table('categories', [col('id'), col('parent_id', 'int8', true)]),
      table('items', [col('id'), col('orderId', 'int8')]),
      table('users', [col('id', 'uuid')]),
      table('sessions', [col('id'), col('user_id', 'uuid')], { uniqueKeys: [['user_id']] })
    ])
    expect(pairs(g)).toEqual([
      'public.categories.parent_id->public.categories.id:medium',
      'public.items.orderId->public.orders.id:medium',
      'public.orders.category_id->public.categories.id:high',
      'public.orders.customer_id->public.customers.id:high',
      'public.sessions.user_id->public.users.id:high'
    ])
    const edges = inferRelationships(g)
    const customer = edges.find((e) => e.fromColumns[0] === 'customer_id')
    expect(customer).toMatchObject({
      id: 'inf:public.orders.customer_id->public.customers', kind: 'inferred', required: true, cardinality: 'many-to-one',
      onDelete: null, onUpdate: null, constraintName: null, selfReference: false, composite: false,
      reason: 'column customer_id matches customers.id (both int8)'
    })
    expect(edges.find((e) => e.fromColumns[0] === 'category_id')?.required).toBe(false)
    expect(edges.find((e) => e.fromColumns[0] === 'parent_id')?.selfReference).toBe(true)
    expect(edges.find((e) => e.fromColumns[0] === 'user_id')?.cardinality).toBe('one-to-one')
    expect(edges.find((e) => e.fromColumns[0] === 'orderId')?.reason).toBe('column orderId matches orders.id (int8 vs int4)')
  })

  it('supports parent_<singular>_id self references', () => {
    const g = graph([table('folders', [col('id'), col('parent_folder_id', 'int8', true)])])
    expect(pairs(g)).toEqual(['public.folders.parent_folder_id->public.folders.id:medium'])
  })

  it('prefers the same schema, then falls back to another schema', () => {
    const g = graph([
      table('accounts', [col('id')], { schema: 'billing', external: true }),
      table('accounts', [col('id')], { schema: 'public' }),
      table('teams', [col('id')], { schema: 'auth', external: true }),
      table('invoices', [col('id'), col('account_id'), col('team_id')])
    ])
    expect(pairs(g)).toEqual(['public.invoices.account_id->public.accounts.id:high', 'public.invoices.team_id->auth.teams.id:high'])
  })

  it('rejects non-matches', () => {
    const g = graph(
      [
        table('customers', [col('id')]),
        table('payments', [col('id'), col('paid', 'bool'), col('valid', 'bool'), col('customer_id', 'text'), col('order_id')]),
        table('orders', [col('id')]),
        table('tags', [col('a'), col('b')], { primaryKey: ['a', 'b'] }),
        table('labels', [col('id')], { primaryKey: [] }),
        table('posts', [col('id'), col('tag_id'), col('label_id'), col('author_id')])
      ],
      [{ name: 'p_o', fromSchema: 'public', fromTable: 'payments', fromColumns: ['order_id'], toSchema: 'public', toTable: 'orders', toColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }]
    )
    expect(pairs(g)).toEqual([])
  })

  it('ignores columns of external tables and a table pointing at itself by name', () => {
    const g = graph([
      table('customers', [col('customer_id')], { primaryKey: ['customer_id'] }),
      table('orders', [col('id'), col('customer_id')], { schema: 'other', external: true })
    ])
    expect(pairs(g)).toEqual([])
  })
})
