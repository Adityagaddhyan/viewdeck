import { randomUUID } from 'node:crypto'
import type { SavedConnection } from '@shared/types/connection'
import { AppErrorException } from '../toAppError'
import { getServices } from '../../services'
import { registerHandler } from '../registry'
import { requireString } from '../validate'
import { requireChangeset, requireConnectionInput, requireParams } from '../validateDb'
import { MAX_FILTER_LENGTH } from '../../drivers/postgres/browseSql'

const sid = (req: { sessionId?: unknown } | undefined): string => requireString(req?.sessionId, 'sessionId')

/** `db:*` channels: sessions, queries, introspection and staged commits. */
export function registerDbHandlers(): void {
  const s = getServices()

  registerHandler('db:connect', async (req) => {
    const id = requireString(req?.connectionId, 'connectionId')
    const conn = s.store.connections.get(id)
    if (!conn) throw new AppErrorException({ code: 'NOT_FOUND', message: 'Saved connection not found.' })
    const session = await s.sessions.connect(conn)
    s.store.connections.touch(id)
    return session
  })

  registerHandler('db:testConnection', async (req) => {
    const { connection, password } = requireConnectionInput(req)
    // An unsaved password lives only in memory for the duration of the test.
    const transientRef = password !== undefined ? s.transientSecrets.put(password) : null
    const now = new Date().toISOString()
    const existing = connection.id ? s.store.connections.get(connection.id) : null
    const conn: SavedConnection = {
      ...connection,
      id: connection.id ?? `test-${randomUUID()}`,
      auth:
        connection.auth.kind === 'password'
          ? { ...connection.auth, secretRef: transientRef ?? (existing?.auth.kind === 'password' ? existing.auth.secretRef : null) }
          : connection.auth,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null
    }
    try {
      return await s.sessions.test(conn)
    } finally {
      if (transientRef) s.transientSecrets.delete(transientRef)
    }
  })

  registerHandler('db:disconnect', (req) => s.sessions.disconnect(sid(req)))
  registerHandler('db:listSessions', () => s.sessions.list())

  registerHandler('db:setReadOnly', (req) => {
    if (typeof req?.readOnly !== 'boolean') {
      throw new AppErrorException({ code: 'VALIDATION', message: 'readOnly must be a boolean' })
    }
    return s.sessions.setReadOnly(sid(req), req.readOnly)
  })

  registerHandler('db:executeQuery', async (req) => {
    const sessionId = sid(req)
    const sql = requireSql(req?.sql)
    const params = requireParams(req?.params)
    const connectionId = s.sessions.info(sessionId).connectionId
    try {
      const result = await s.sessions.driver(sessionId).executeQuery(sql, params)
      s.store.history.add({ connectionId, sql, durationMs: result.durationMs, rowCount: result.rowCount, error: null })
      return result
    } catch (err) {
      const message = err instanceof AppErrorException ? err.appError.message : String(err)
      s.store.history.add({ connectionId, sql, durationMs: null, rowCount: null, error: message })
      throw err
    }
  })

  registerHandler('db:explain', (req) => s.sessions.driver(sid(req)).explain(requireSql(req?.sql), { analyze: req?.analyze === true }))
  registerHandler('db:ping', async (req) => ({ ms: await s.sessions.driver(sid(req)).ping() }))
  registerHandler('db:cancelQuery', async (req) => ({ cancelled: await s.sessions.driver(sid(req)).cancelQuery() }))
  registerHandler('db:setStatementTimeout', (req) =>
    s.sessions.setStatementTimeout(sid(req), clampInt(req?.ms, 0, 24 * 3600 * 1000, 0))
  )
  registerHandler('db:listSchemas', (req) => s.sessions.driver(sid(req)).listSchemas())
  registerHandler('db:listTables', (req) => s.sessions.driver(sid(req)).listTables(requireString(req?.schema, 'schema')))
  registerHandler('db:getTableColumns', (req) =>
    s.sessions.driver(sid(req)).getTableColumns(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'))
  )
  registerHandler('db:getPrimaryKeys', (req) =>
    s.sessions.driver(sid(req)).getPrimaryKeys(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'))
  )
  registerHandler('db:getSchemaSnapshot', (req) => s.sessions.driver(sid(req)).getSchemaSnapshot())
  registerHandler('db:getSchemaGraph', (req) => s.sessions.driver(sid(req)).getSchemaGraph(requireString(req?.schema, 'schema')))
  registerHandler('db:getTableDetails', (req) =>
    s.sessions.driver(sid(req)).getTableDetails(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'))
  )
  registerHandler('db:listSchemaObjects', (req) => s.sessions.driver(sid(req)).listSchemaObjects(requireString(req?.schema, 'schema')))
  registerHandler('db:getObjectDefinition', (req) => {
    const kind = req?.kind
    if (kind !== 'function' && kind !== 'sequence' && kind !== 'type') {
      throw new AppErrorException({ code: 'VALIDATION', message: 'kind must be function, sequence or type' })
    }
    return s.sessions.driver(sid(req)).getObjectDefinition(kind, requireString(req?.id, 'id', /^\d+$/))
  })
  registerHandler('db:getForeignKeys', (req) =>
    s.sessions.driver(sid(req)).getForeignKeys(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'))
  )
  registerHandler('db:countRows', (req) =>
    s.sessions.driver(sid(req)).countRows(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'), {
      exact: req?.exact === true,
      where: optionalFragment(req?.where, 'where')
    })
  )
  registerHandler('db:selectRows', (req) => {
    const limit = clampInt(req?.limit, 1, 10_000, 500)
    const offset = clampInt(req?.offset, 0, Number.MAX_SAFE_INTEGER, 0)
    return s.sessions.driver(sid(req)).selectRows(requireString(req?.schema, 'schema'), requireString(req?.table, 'table'), {
      limit,
      offset,
      where: optionalFragment(req?.where, 'where'),
      orderBy: optionalFragment(req?.orderBy, 'orderBy')
    })
  })
  registerHandler('db:previewChanges', (req) => s.sessions.driver(sid(req)).previewChanges(requireChangeset(req?.changeset)))
  registerHandler('db:commitChanges', (req) => s.sessions.driver(sid(req)).commitChanges(requireChangeset(req?.changeset)))
}

/** Optional raw SQL fragment from the grid filter bar (see browseSql.ts). */
function optionalFragment(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || v.length > MAX_FILTER_LENGTH) {
    throw new AppErrorException({ code: 'VALIDATION', message: `${field} must be text under ${MAX_FILTER_LENGTH} characters` })
  }
  return v
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback
}

function requireSql(v: unknown): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new AppErrorException({ code: 'VALIDATION', message: 'sql must be a non-empty string' })
  }
  return v
}
