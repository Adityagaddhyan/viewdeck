import { getServices } from '../../services'
import { registerHandler } from '../registry'
import { requireString } from '../validate'
import { requireConnectionInput } from '../validateDb'
import { AppErrorException } from '../toAppError'
import { normalizeSettings } from '@shared/settings'
import { applyNativeTheme } from '../../nativeTheme'

/** `connections:*`, `history:*` and `prefs:*` channels backed by LocalStore. */
export function registerStoreHandlers(): void {
  const s = getServices()

  registerHandler('connections:list', () => s.store.connections.list())

  registerHandler('connections:save', (req) => {
    const { connection, password } = requireConnectionInput(req)
    const existing = connection.id ? s.store.connections.get(connection.id) : null
    const oldRef = existing?.auth.kind === 'password' ? existing.auth.secretRef : null

    let auth = connection.auth
    if (auth.kind === 'password') {
      // Encrypt immediately. Plaintext never reaches the connections table.
      const secretRef = password !== undefined ? s.store.secrets.put(password, oldRef ?? undefined) : oldRef
      auth = { kind: 'password', user: auth.user, secretRef }
    } else if (oldRef) {
      s.store.secrets.delete(oldRef) // Switched to IAM: drop the old password.
    }
    return s.store.connections.save({ ...connection, auth })
  })

  registerHandler('connections:delete', (req) => {
    const id = requireString(req?.id, 'id')
    const existing = s.store.connections.get(id)
    if (existing?.auth.kind === 'password' && existing.auth.secretRef) s.store.secrets.delete(existing.auth.secretRef)
    s.store.connections.delete(id)
  })

  registerHandler('connections:duplicate', (req) => {
    const src = s.store.connections.get(requireString(req?.id, 'id'))
    if (!src) throw new AppErrorException({ code: 'NOT_FOUND', message: 'Saved connection not found.' })
    const { id: _id, createdAt: _c, updatedAt: _u, lastUsedAt: _l, ...rest } = src
    let auth = src.auth
    if (auth.kind === 'password' && auth.secretRef) {
      auth = { ...auth, secretRef: s.store.secrets.put(s.store.secrets.get(auth.secretRef)) }
    }
    return s.store.connections.save({ ...rest, auth, name: `${src.name} (copy)` })
  })

  registerHandler('history:list', (req) => {
    const connectionId = req?.connectionId === null ? null : requireString(req?.connectionId, 'connectionId')
    const limit = typeof req?.limit === 'number' ? Math.min(Math.max(1, Math.floor(req.limit)), 1000) : 200
    return s.store.history.list(connectionId, limit)
  })

  const optConn = (v: unknown): string | null => (v === null || v === undefined ? null : requireString(v, 'connectionId'))
  registerHandler('queries:list', (req) => s.store.savedQueries.list(optConn(req?.connectionId)))
  registerHandler('queries:save', (req) => {
    const sql = req?.sql
    if (typeof sql !== 'string' || !sql.trim() || sql.length > 1_000_000) {
      throw new AppErrorException({ code: 'VALIDATION', message: 'sql must be non-empty text under 1 MB' })
    }
    return s.store.savedQueries.save({
      id: req?.id === undefined ? undefined : requireString(req.id, 'id'),
      connectionId: optConn(req?.connectionId),
      name: requireString(req?.name, 'name'),
      sql
    })
  })
  registerHandler('queries:delete', (req) => s.store.savedQueries.delete(requireString(req?.id, 'id')))

  registerHandler('settings:get', () => normalizeSettings(s.store.preferences.get('settings')))
  registerHandler('settings:set', (req) => {
    const next = normalizeSettings(req?.settings)
    s.store.preferences.set('settings', next)
    applyNativeTheme(next.theme)
    return next
  })

  registerHandler('prefs:get', (req) => s.store.preferences.get(requireString(req?.key, 'key')))
  registerHandler('prefs:set', (req) => s.store.preferences.set(requireString(req?.key, 'key'), req?.value))
}
