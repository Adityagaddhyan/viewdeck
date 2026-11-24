import { describe, expect, it } from 'vitest'
import type { GraphColumn, GraphForeignKey, GraphTable, SchemaGraph } from '@shared/types/diagram'
import { buildDiagramModel } from './graphModel'
import { findJoinPath, joinPathSql, neighborhood, quoteIdent } from './joinPath'

const col = (name: string, dataType = 'int8'): GraphColumn => ({ name, dataType, nullable: false, comment: null })

function table(name: string, columns: string[], opts: Partial<GraphTable> = {}): GraphTable {
  return {
    schema: 'public', name, kind: 'table', external: false, columns: columns.map((c) => col(c)), primaryKey: ['id'], uniqueKeys: [],
    rowEstimate: null, totalBytes: null, comment: null, ...opts
  }
}

function fk(name: string, fromTable: string, fromColumns: string[], toTable: string, toColumns = ['id'], extra: Partial<GraphForeignKey> = {}): GraphForeignKey {
  return { name, fromSchema: 'public', fromTable, fromColumns, toSchema: 'public', toTable, toColumns, onDelete: 'NO ACTION', onUpdate: 'NO ACTION', ...extra }
}

const graph = (tables: GraphTable[], foreignKeys: GraphForeignKey[] = []): SchemaGraph => ({ schema: 'public', tables, foreignKeys, fetchedAt: '' })

const shop = buildDiagramModel(
  graph(
    [
      table('customers', ['id']),
      table('orders', ['id', 'customer_id']),
      table('order_items', ['id', 'order_id', 'product_id']),
      table('products', ['id']),
      table('shipments', ['id', 'order_id', 'warehouse_id']),
      table('warehouses', ['id', 'customer_id']),
      table('settings', ['id'])
    ],
    [
      fk('orders_customer_fk', 'orders', ['customer_id'], 'customers'),
      fk('oi_order_fk', 'order_items', ['order_id'], 'orders'),
      fk('oi_product_fk', 'order_items', ['product_id'], 'products'),
      fk('shipments_order_fk', 'shipments', ['order_id'], 'orders')
    ]
  ),
  { inferred: true }
)

describe('neighborhood', () => {
  it('walks undirected to the given depth, including the start', () => {
    expect([...neighborhood(shop, 'public.products', 0)]).toEqual(['public.products'])
    expect([...neighborhood(shop, 'public.products', 1)].sort()).toEqual(['public.order_items', 'public.products'])
    expect([...neighborhood(shop, 'public.products', 2)].sort()).toEqual(['public.order_items', 'public.orders', 'public.products'])
  })
})

describe('findJoinPath', () => {
  it('returns [] for the same table and null when unreachable or unknown', () => {
    expect(findJoinPath(shop, 'public.orders', 'public.orders')).toEqual([])
    expect(findJoinPath(shop, 'public.orders', 'public.settings')).toBeNull()
    expect(findJoinPath(shop, 'public.orders', 'public.nope')).toBeNull()
  })

  it('prefers real FKs over an equally short inferred route', () => {
    const path = findJoinPath(shop, 'public.shipments', 'public.customers')
    expect(path?.map((e) => e.id)).toEqual(['fk:public.shipments_order_fk', 'fk:public.orders_customer_fk'])
  })

  it('uses inferred edges when they are the only route', () => {
    const path = findJoinPath(shop, 'public.warehouses', 'public.customers')
    expect(path?.map((e) => e.kind)).toEqual(['inferred'])
  })
})

describe('joinPathSql', () => {
  const path = findJoinPath(shop, 'public.orders', 'public.products') ?? []

  it('renders a 3-table path from the parent side', () => {
    expect(joinPathSql(shop, 'public.orders', path)).toBe(
      'SELECT *\nFROM orders o\nJOIN order_items oi ON oi.order_id = o.id\nJOIN products p ON p.id = oi.product_id\nLIMIT 100;'
    )
  })

  it('renders the same path walked from the other end', () => {
    const back = findJoinPath(shop, 'public.products', 'public.orders') ?? []
    expect(joinPathSql(shop, 'public.products', back)).toBe(
      'SELECT *\nFROM products p\nJOIN order_items oi ON oi.product_id = p.id\nJOIN orders o ON o.id = oi.order_id\nLIMIT 100;'
    )
  })

  it('dedupes aliases, quotes when needed, qualifies other schemas and ANDs composite keys', () => {
    const m = buildDiagramModel(
      graph(
        [
          table('organizations', ['id']),
          table('user', ['id', 'organization_id', 'Tenant', 'org_ref']),
          table('order_notes', ['id', 'user_id', 'tenant']),
          table('regions', ['id'], { schema: 'Geo', external: true })
        ],
        [
          fk('u_org', 'user', ['organization_id'], 'organizations'),
          fk('n_user', 'order_notes', ['user_id', 'tenant'], 'user', ['id', 'Tenant']),
          fk('org_region', 'organizations', ['id'], 'regions', ['id'], { toSchema: 'Geo' })
        ]
      ),
      { inferred: false }
    )
    const p = findJoinPath(m, 'public.order_notes', 'Geo.regions') ?? []
    expect(joinPathSql(m, 'public.order_notes', p)).toBe(
      [
        'SELECT *',
        'FROM order_notes on2',
        'JOIN "user" u ON u.id = on2.user_id AND u."Tenant" = on2.tenant',
        'JOIN organizations o ON o.id = u.organization_id',
        'JOIN "Geo".regions r ON r.id = o.id',
        'LIMIT 100;'
      ].join('\n')
    )
    expect(quoteIdent('select')).toBe('"select"')
    expect(quoteIdent('a"b')).toBe('"a""b"')
  })
})
