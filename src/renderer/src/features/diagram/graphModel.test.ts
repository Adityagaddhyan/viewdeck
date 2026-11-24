import { describe, expect, it } from 'vitest'
import type { GraphColumn, GraphForeignKey, GraphTable, SchemaGraph } from '@shared/types/diagram'
import { buildDiagramModel } from './graphModel'

const col = (name: string, dataType = 'int8', nullable = false): GraphColumn => ({ name, dataType, nullable, comment: null })

function table(name: string, columns: GraphColumn[], opts: Partial<GraphTable> = {}): GraphTable {
  return {
    schema: 'public', name, kind: 'table', external: false, columns, primaryKey: ['id'], uniqueKeys: [],
    rowEstimate: null, totalBytes: null, comment: null, ...opts
  }
}

function fk(name: string, fromTable: string, fromColumns: string[], toTable: string, toColumns = ['id'], extra: Partial<GraphForeignKey> = {}): GraphForeignKey {
  return {
    name, fromSchema: 'public', fromTable, fromColumns, toSchema: 'public', toTable, toColumns,
    onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...extra
  }
}

const graph = (tables: GraphTable[], foreignKeys: GraphForeignKey[] = []): SchemaGraph => ({ schema: 'public', tables, foreignKeys, fetchedAt: '2026-01-01T00:00:00Z' })

describe('buildDiagramModel: real foreign keys', () => {
  const g = graph(
    [
      table('customers', [col('id'), col('email', 'text')], { uniqueKeys: [['email']] }),
      table('orders', [col('id'), col('customer_id'), col('coupon_id', 'int8', true), col('note', 'text', true)]),
      table('coupons', [col('id')]),
      table('customer_profiles', [col('customer_id'), col('bio', 'text', true)], { primaryKey: ['customer_id'] }),
      table('passports', [col('id'), col('customer_id', 'int8', true)], { uniqueKeys: [['customer_id']] }),
      table('order_lines', [col('order_id'), col('line_no', 'int4')], { primaryKey: ['order_id', 'line_no'] }),
      table('shipments', [col('id'), col('order_id'), col('line_no', 'int4')]),
      table('employees', [col('id'), col('manager_id', 'int8', true)]),
      table('accounts', [col('id')], { schema: 'billing', external: true })
    ],
    [
      fk('orders_customer_fk', 'orders', ['customer_id'], 'customers', ['id'], { onDelete: 'CASCADE' }),
      fk('orders_coupon_fk', 'orders', ['coupon_id'], 'coupons', ['id'], { onDelete: 'SET NULL' }),
      fk('profiles_customer_fk', 'customer_profiles', ['customer_id'], 'customers'),
      fk('passports_customer_fk', 'passports', ['customer_id'], 'customers'),
      fk('order_lines_order_fk', 'order_lines', ['order_id'], 'orders'),
      fk('shipments_line_fk', 'shipments', ['order_id', 'line_no'], 'order_lines', ['order_id', 'line_no']),
      fk('employees_manager_fk', 'employees', ['manager_id'], 'employees'),
      fk('customers_account_fk', 'customers', ['id'], 'accounts', ['id'], { toSchema: 'billing' }),
      fk('dangling_fk', 'orders', ['id'], 'missing')
    ]
  )
  const m = buildDiagramModel(g, { inferred: false })
  const edge = (name: string) => m.edges.find((e) => e.constraintName === name)

  it('maps required, optional, cardinality and actions', () => {
    expect(edge('orders_customer_fk')).toMatchObject({
      id: 'fk:public.orders_customer_fk', from: 'public.orders', to: 'public.customers', kind: 'fk',
      required: true, cardinality: 'many-to-one', onDelete: 'CASCADE', onUpdate: 'NO ACTION', selfReference: false, composite: false
    })
    expect(edge('orders_coupon_fk')).toMatchObject({ required: false, cardinality: 'many-to-one', onDelete: 'SET NULL' })
  })

  it('detects one-to-one via PK and via unique key', () => {
    expect(edge('profiles_customer_fk')).toMatchObject({ cardinality: 'one-to-one', required: true })
    expect(edge('passports_customer_fk')).toMatchObject({ cardinality: 'one-to-one', required: false })
  })

  it('handles composite and self-referencing keys', () => {
    expect(edge('shipments_line_fk')).toMatchObject({ composite: true, cardinality: 'many-to-one', fromColumns: ['order_id', 'line_no'] })
    expect(edge('employees_manager_fk')).toMatchObject({ selfReference: true, required: false })
    const emp = m.byId.get('public.employees')
    expect([emp?.inDegree, emp?.outDegree]).toEqual([1, 1])
  })

  it('keeps external stubs, drops dangling FKs, computes key columns', () => {
    expect(m.byId.get('billing.accounts')?.external).toBe(true)
    expect(edge('customers_account_fk')?.to).toBe('billing.accounts')
    expect(edge('dangling_fk')).toBeUndefined()
    expect(m.byId.get('public.orders')?.keyColumns).toEqual(['id', 'customer_id', 'coupon_id'])
    expect(m.byId.get('public.customers')?.inDegree).toBe(3)
  })

  it('lists hubs (degree >= 3, non-external) and isolated tables', () => {
    expect(m.hubs).toEqual(['public.customers', 'public.orders'])
    const lonely = buildDiagramModel(graph([table('zeta', [col('id')]), table('alpha', [col('id')])]), { inferred: false })
    expect(lonely.isolated).toEqual(['public.alpha', 'public.zeta'])
    expect(m.isolated).toEqual([])
  })

  it('adds inferred edges only when asked', () => {
    const g2 = graph([table('customers', [col('id')]), table('orders', [col('id'), col('customer_id')])])
    expect(buildDiagramModel(g2, { inferred: false }).edges).toHaveLength(0)
    const withInf = buildDiagramModel(g2, { inferred: true })
    expect(withInf.edges.map((e) => e.kind)).toEqual(['inferred'])
    expect(withInf.byId.get('public.orders')?.keyColumns).toEqual(['id', 'customer_id'])
  })
})

describe('buildDiagramModel: clusters', () => {
  it('groups components, buckets singletons and labels by the most connected table', () => {
    const g = graph(
      [
        table('customers', [col('id')]), table('orders', [col('id'), col('customer_id')]), table('invoices', [col('id'), col('customer_id')]),
        table('posts', [col('id')]), table('comments', [col('id'), col('post_id')]),
        table('settings', [col('id')]), table('audit', [col('id')])
      ],
      [fk('o_c', 'orders', ['customer_id'], 'customers'), fk('i_c', 'invoices', ['customer_id'], 'customers'), fk('c_p', 'comments', ['post_id'], 'posts')]
    )
    const m = buildDiagramModel(g, { inferred: false })
    expect(m.clusters.map((c) => [c.id, c.label, c.size])).toEqual([[0, 'customers', 3], [1, 'comments', 2], [2, 'Unconnected', 2]])
    expect(m.byId.get('public.orders')?.cluster).toBe(0)
    expect(m.clusters[2]?.nodeIds).toEqual(['public.audit', 'public.settings'])
    expect(buildDiagramModel(g, { inferred: false }).clusters).toEqual(m.clusters)
  })

  it('splits a large component into communities around its hubs', () => {
    const tables = [table('hub_a', [col('id')]), table('hub_b', [col('id')])]
    const fks: GraphForeignKey[] = []
    for (let i = 0; i < 14; i++) {
      for (const side of ['a', 'b']) {
        tables.push(table(`${side}_${String(i).padStart(2, '0')}`, [col('id'), col('hub_ref')]))
        fks.push(fk(`${side}${i}`, `${side}_${String(i).padStart(2, '0')}`, ['hub_ref'], `hub_${side}`))
      }
    }
    fks.push(fk('bridge', 'a_00', ['id'], 'hub_b'))
    const m = buildDiagramModel(graph(tables, fks), { inferred: false })
    expect(m.clusters.map((c) => [c.label, c.size])).toEqual([['hub_a', 15], ['hub_b', 15]])
    expect(m.byId.get('public.b_05')?.cluster).toBe(m.byId.get('public.hub_b')?.cluster)
  })
})

describe('buildDiagramModel: performance', () => {
  it('builds 300 tables / 1,000 FKs quickly', () => {
    let seed = 42
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const name = (i: number): string => `t${String(i).padStart(3, '0')}`
    const tables: GraphTable[] = []
    for (let i = 0; i < 300; i++) {
      const cols = [col('id')]
      for (let j = 0; j < 4; j++) cols.push(col(`ref${j}`))
      cols.push(col(`${name(rand(300))}_id`), col('name', 'text'))
      tables.push(table(name(i), cols))
    }
    const fks: GraphForeignKey[] = []
    for (let n = 0; n < 1000; n++) {
      const i = n % 300
      fks.push(fk(`fk${n}`, name(i), [`ref${n % 4}`], name(rand(300))))
    }
    const start = performance.now()
    const m = buildDiagramModel(graph(tables, fks), { inferred: true })
    const ms = performance.now() - start
    expect(m.edges.length).toBeGreaterThanOrEqual(1000)
    expect(m.clusters.reduce((s, c) => s + c.size, 0)).toBe(300)
    expect(ms).toBeLessThan(200)
  })
})
