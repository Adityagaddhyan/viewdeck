/** Starred queries, scoped to a saved connection or global (connection_id NULL). */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SavedQuery } from '@shared/types/connection'

interface Row {
  id: string
  connection_id: string | null
  name: string
  sql: string
  created_at: string
  updated_at: string
}

const fromRow = (r: Row): SavedQuery => ({
  id: r.id,
  connectionId: r.connection_id,
  name: r.name,
  sql: r.sql,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export class SavedQueryRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Queries for this connection plus global ones, alphabetically. */
  list(connectionId: string | null): SavedQuery[] {
    const rows = this.db
      .prepare('SELECT * FROM saved_queries WHERE connection_id IS ? OR connection_id IS NULL ORDER BY lower(name), created_at')
      .all(connectionId) as unknown as Row[]
    return rows.map(fromRow)
  }

  save(input: { id?: string; connectionId: string | null; name: string; sql: string }): SavedQuery {
    const now = new Date().toISOString()
    const id = input.id ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO saved_queries (id, connection_id, name, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET connection_id = excluded.connection_id, name = excluded.name, sql = excluded.sql, updated_at = excluded.updated_at`
      )
      .run(id, input.connectionId, input.name, input.sql, now, now)
    return fromRow(this.db.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id) as unknown as Row)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id)
  }
}
