import { describe, expect, it } from 'vitest'
import type { Tab } from './store'
import { restoreWorkspace, serializeWorkspace } from './workspacePersistence'

describe('workspace persistence', () => {
  it('round-trips query text, table filters and the active tab', () => {
    const tabs: Tab[] = [
      { id: 't1', kind: 'query', title: 'Query 1', sql: 'select 1' },
      { id: 't2', kind: 'table', title: 'orders', schema: 'shop', table: 'orders', savedFilter: { where: "status = 'paid'", orderBy: '"id" DESC' } }
    ]
    const saved = serializeWorkspace(tabs, 't2')
    expect(saved).toEqual({
      v: 1,
      activeIndex: 1,
      tabs: [
        { kind: 'query', title: 'Query 1', sql: 'select 1' },
        { kind: 'table', title: 'orders', schema: 'shop', table: 'orders', where: "status = 'paid'", orderBy: '"id" DESC' }
      ]
    })
    let n = 0
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(saved)), () => `new-${++n}`)
    expect(restored?.activeIndex).toBe(1)
    expect(restored?.tabs[0]).toEqual({ id: 'new-1', kind: 'query', title: 'Query 1', sql: 'select 1' })
    expect(restored?.tabs[1]).toMatchObject({ id: 'new-2', kind: 'table', filterRequest: { where: "status = 'paid'", orderBy: '"id" DESC' } })
  })

  it('ignores missing or foreign data', () => {
    expect(restoreWorkspace(null, () => 'x')).toBeNull()
    expect(restoreWorkspace({ v: 9 }, () => 'x')).toBeNull()
  })
})
