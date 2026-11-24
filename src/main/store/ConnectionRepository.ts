/**
 * Saved connections. Stored as JSON in `config_json` (everything except the
 * indexed columns), so adding fields needs no migration.
 * Never contains secrets, only `auth.secretRef`.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SavedConnection } from '@shared/types/connection'

interface Row {
  id: string
  name: string
  engine: string
  config_json: string
  created_at: string
  updated_at: string
  last_used_at: string | null
}

type Persisted = Omit<SavedConnection, 'id' | 'name' | 'engine' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>

function fromRow(r: Row): SavedConnection {
  const cfg = JSON.parse(r.config_json) as Persisted
  return {
    ...cfg,
    id: r.id,
    name: r.name,
    engine: r.engine as SavedConnection['engine'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at
  }
}

export class ConnectionRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): SavedConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM connections ORDER BY last_used_at IS NULL, last_used_at DESC, name')
      .all() as unknown as Row[]
    return rows.map(fromRow)
  }

  get(id: string): SavedConnection | null {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Row | undefined
    return row ? fromRow(row) : null
  }

  /** Inserts (no id) or updates (existing id). Returns the stored record. */
  save(input: Omit<SavedConnection, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt'> & { id?: string }): SavedConnection {
    const now = new Date().toISOString()
    const { id: maybeId, name, engine, ...rest } = input
    const id = maybeId ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO connections (id, name, engine, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, engine = excluded.engine,
           config_json = excluded.config_json, updated_at = excluded.updated_at`
      )
      .run(id, name, engine, JSON.stringify(rest), now, now)
    return this.get(id) as SavedConnection
  }

  touch(id: string): void {
    this.db.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  }
}
