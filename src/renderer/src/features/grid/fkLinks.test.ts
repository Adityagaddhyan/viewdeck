import { describe, expect, it } from 'vitest'
import type { ForeignKeyInfo } from '@shared/types/driver'
import { incomingTargets, outgoingTarget } from './fkLinks'

const toCustomer: ForeignKeyInfo = { name: 'fk_customer', schema: 'billing', table: 'periods', columns: ['customer_id'], refSchema: 'billing', refTable: 'customers', refColumns: ['id'] }
const composite: ForeignKeyInfo = { name: 'fk_lines', schema: 'shop', table: 'lines', columns: ['tenant', 'order_id'], refSchema: 'shop', refTable: 'orders', refColumns: ['tenant', 'id'] }

describe('fkLinks', () => {
  it('outgoing: opens the referenced row', () => {
    expect(outgoingTarget('customer_id', { customer_id: 'b26182c9' }, [toCustomer])).toEqual({
      schema: 'billing',
      table: 'customers',
      where: `"id" = 'b26182c9'`,
      label: 'Open referenced row in customers'
    })
    expect(outgoingTarget('name', { name: 'x' }, [toCustomer])).toBeNull()
    expect(outgoingTarget('customer_id', { customer_id: null }, [toCustomer])).toBeNull()
  })
  it('incoming: composite keys map parent values onto child columns', () => {
    expect(incomingTargets('id', { tenant: 'a', id: 7 }, [composite])).toEqual([
      { schema: 'shop', table: 'lines', where: `"tenant" = 'a' AND "order_id" = 7`, label: 'Rows in shop.lines (tenant, order_id)' }
    ])
    expect(incomingTargets('status', { status: 'x' }, [composite])).toEqual([])
  })
})
