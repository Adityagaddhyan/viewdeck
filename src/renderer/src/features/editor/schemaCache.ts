/**
 * Per-session schema metadata for autocomplete and the explorer, built for speed:
 *
 * 1. On connect, the last snapshot for this saved connection is loaded from
 *    LocalStore (`prefs`), so suggestions are instant even before the network
 *    answers. Over VPN to prod that saves seconds.
 * 2. A fresh snapshot (one `db:getSchemaSnapshot` round trip for every schema,
 *    table and column) replaces it in the background and is persisted again.
 * 3. Lookups go through an in-memory SchemaIndex: synchronous Map hits, no IPC
 *    per keystroke.
 *
 * Detailed column info (nullability, defaults, PKs) still loads lazily per
 * table via `getColumns`. `invalidate()` (after DDL / Refresh) keeps the stale
 * index until the fresh snapshot arrives, so autocomplete never goes blank.
 */
import type { ColumnInfo, SchemaInfo, SchemaSnapshot, TableInfo } from '@shared/types/driver'
import { call } from '@renderer/lib/ipc'
import { SchemaIndex } from './schemaIndex'

const PREF_KEY = (connectionId: string): string => `schemaSnapshot:${connectionId}`

class SchemaCache {
  private sessionId: string | null = null
  private connectionId: string | null = null
  private idx: SchemaIndex | null = null
  private snapshotLoad: Promise<SchemaIndex | null> | null = null
  private columns = new Map<string, Promise<ColumnInfo[]>>()
  private listeners = new Set<() => void>()

  /** Switches to a session. Loads the cached snapshot, then refreshes it in the background. */
  use(sessionId: string | null, connectionId: string | null = null): void {
    if (sessionId === this.sessionId) return
    this.sessionId = sessionId
    this.connectionId = connectionId
    this.idx = null
    this.columns.clear()
    this.snapshotLoad = null
    if (sessionId) void this.warm()
  }

  /** The current index, or null while the first snapshot is loading. */
  get index(): SchemaIndex | null {
    return this.idx
  }

  /** Called when a (new) index becomes available, e.g. to re-render the explorer. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setIndex(snap: SchemaSnapshot): SchemaIndex {
    this.idx = new SchemaIndex(snap)
    for (const fn of this.listeners) fn()
    return this.idx
  }

  private async warm(): Promise<void> {
    const sid = this.sessionId
    const cid = this.connectionId
    if (cid) {
      const cached = await call('prefs:get', { key: PREF_KEY(cid) }).catch(() => null)
      if (cached && sid === this.sessionId && !this.idx) this.setIndex(cached as SchemaSnapshot)
    }
    await this.refresh()
  }

  /** Fetches a fresh snapshot (deduplicated) and persists it for the next launch. */
  refresh(): Promise<SchemaIndex | null> {
    if (this.snapshotLoad) return this.snapshotLoad
    const sid = this.sessionId
    if (!sid) return Promise.resolve(null)
    const cid = this.connectionId
    this.snapshotLoad = call('db:getSchemaSnapshot', { sessionId: sid })
      .then((snap) => {
        if (sid !== this.sessionId) return null
        if (cid) void call('prefs:set', { key: PREF_KEY(cid), value: snap }).catch(() => {})
        return this.setIndex(snap)
      })
      .catch(() => this.idx)
      .finally(() => {
        this.snapshotLoad = null
      })
    return this.snapshotLoad
  }

  /** After DDL or a manual refresh. Stale data keeps serving until the fresh snapshot lands. */
  invalidate(): void {
    this.columns.clear()
    void this.refresh()
  }

  private sid(): string {
    if (!this.sessionId) throw new Error('No active session')
    return this.sessionId
  }

  private async ready(): Promise<SchemaIndex | null> {
    return this.idx ?? (await (this.snapshotLoad ?? this.refresh()))
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const idx = await this.ready()
    if (idx) return idx.schemas.map((name) => ({ name }))
    return call('db:listSchemas', { sessionId: this.sid() })
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const idx = await this.ready()
    if (idx) return idx.tablesIn(schema).map((t) => ({ schema: t.schema, name: t.name, kind: t.kind }))
    return call('db:listTables', { sessionId: this.sid(), schema })
  }

  /** Full column details (nullability, defaults, PK). Lazily fetched per table and cached. */
  getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const key = `${schema}\u0000${table}`
    let p = this.columns.get(key)
    if (!p) {
      p = call('db:getTableColumns', { sessionId: this.sid(), schema, table }).catch((e: unknown) => {
        this.columns.delete(key)
        throw e
      })
      this.columns.set(key, p)
    }
    return p
  }
}

export const schemaCache = new SchemaCache()
