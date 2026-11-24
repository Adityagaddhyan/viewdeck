/**
 * Builds command-palette entries from the current app state: actions, tables
 * (all schemas), schemas (as filters), recent queries and saved connections.
 *
 * Safety: the palette can LOCK a session but never unlock it. Unlocking stays
 * an explicit toolbar click with its confirmation (ADR-003).
 */
import { call } from '@renderer/lib/ipc'
import { actions, getState, setState } from '@renderer/lib/store'
import { schemaCache } from '../editor/schemaCache'
import { connectTo } from '@renderer/lib/sessions'
import { setTheme } from '@renderer/lib/theme'
import { checkForUpdatesNow } from '@renderer/lib/updates'

export type PaletteGroup = 'Actions' | 'Tables' | 'Schemas' | 'Starred' | 'Recent queries' | 'Connections'

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  detail?: string
  shortcut?: string
  /** Text matched by the fuzzy filter (defaults to label). */
  searchText?: string
  /** Return a string to replace the palette query instead of closing (e.g. schema filter). */
  run: () => void | string | Promise<void>
}

/** Cap on schemas scanned for tables, so huge catalogs don't stall the palette. */
const MAX_SCHEMAS = 100

async function switchTo(connectionId: string): Promise<void> {
  try {
    await connectTo(connectionId)
  } catch (err) {
    actions.showToast(`Could not connect: ${(err as Error).message}`)
  }
}

export async function buildPaletteItems(mod: string): Promise<PaletteItem[]> {
  const { session } = getState()
  const items: PaletteItem[] = []

  if (session) {
    items.push({ id: 'a:new-tab', group: 'Actions', label: 'New query tab', shortcut: `${mod}T`, run: () => actions.newQueryTab() })
    if (!session.readOnly) {
      items.push({
        id: 'a:lock',
        group: 'Actions',
        label: 'Lock session (read-only)',
        run: async () => actions.updateSession(await call('db:setReadOnly', { sessionId: session.id, readOnly: true }))
      })
    }
    items.push({
      id: 'a:refresh',
      group: 'Actions',
      label: 'Refresh schema',
      run: () => {
        schemaCache.invalidate()
        actions.bumpSchemaVersion()
      }
    })
    items.push({
      id: 'a:disconnect',
      group: 'Actions',
      label: 'Disconnect',
      run: async () => {
        await call('db:disconnect', { sessionId: session.id }).catch(() => {})
        schemaCache.use(null)
        actions.endSession()
      }
    })
  }
  items.push({ id: 'a:updates', group: 'Actions', label: 'Check for updates', searchText: 'check for updates upgrade new version release', run: () => void checkForUpdatesNow() })
  const theme = getState().settings.theme
  for (const [mode, label] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System (follow macOS)']] as const) {
    if (mode !== theme) items.push({ id: `a:theme-${mode}`, group: 'Actions', label: `Theme: ${label}`, searchText: `theme appearance mode ${label}`, run: () => void setTheme(mode) })
  }
  items.push({ id: 'a:aws', group: 'Actions', label: 'New AWS connection…', run: () => setState({ screen: { name: 'aws-wizard' }, notice: null }) })

  const [conns, history, tables, starred] = await Promise.all([
    call('connections:list').catch(() => []),
    session ? call('history:list', { connectionId: session.connectionId, limit: 50 }).catch(() => []) : Promise.resolve([]),
    session ? loadTables() : Promise.resolve([] as Array<{ schema: string; name: string; kind: string }>),
    session ? call('queries:list', { connectionId: session.connectionId }).catch(() => []) : Promise.resolve([])
  ])
  for (const q of starred) {
    items.push({ id: `star:${q.id}`, group: 'Starred', label: q.name, searchText: `${q.name} ${q.sql}`, detail: q.connectionId ? 'this connection' : 'all connections', run: () => actions.newQueryTab(q.sql) })
  }

  if (session) {
    const schemas = [...new Set(tables.map((t) => t.schema))]
    for (const t of tables) {
      items.push({
        id: `t:${t.schema}.${t.name}`,
        group: 'Tables',
        label: `${t.schema}.${t.name}`,
        detail: t.kind,
        run: () => actions.openTable(t.schema, t.name)
      })
    }
    for (const s of schemas) items.push({ id: `s:${s}`, group: 'Schemas', label: s, detail: 'filter tables', run: () => `${s}.` })
    for (const s of schemas) items.push({ id: `d:${s}`, group: 'Schemas', label: `Diagram: ${s}`, searchText: `diagram er erd schema relationships ${s}`, detail: 'ER diagram', run: () => actions.openDiagram(s) })
    const seen = new Set<string>()
    for (const h of history) {
      if (h.error || seen.has(h.sql)) continue
      seen.add(h.sql)
      const oneLine = h.sql.replace(/\s+/g, ' ').trim()
      items.push({
        id: `h:${h.id}`,
        group: 'Recent queries',
        label: oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine,
        searchText: oneLine,
        detail: new Date(h.executedAt).toLocaleString(),
        run: () => actions.newQueryTab(h.sql)
      })
    }
  }

  for (const c of conns) {
    if (c.id === session?.connectionId) continue
    items.push({
      id: `c:${c.id}`,
      group: 'Connections',
      label: c.name,
      detail: c.aws ? `${c.aws.profile} · ${c.aws.region}` : c.route.kind === 'direct' ? c.route.host : '',
      run: () => switchTo(c.id)
    })
  }
  return items
}

async function loadTables(): Promise<Array<{ schema: string; name: string; kind: string }>> {
  const schemas = (await schemaCache.listSchemas()).slice(0, MAX_SCHEMAS)
  const lists = await Promise.all(schemas.map((s) => schemaCache.listTables(s.name).catch(() => [])))
  return lists.flat().map((t) => ({ schema: t.schema, name: t.name, kind: t.kind }))
}
