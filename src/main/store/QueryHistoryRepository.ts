/**
 * Query history for the editor's history panel and the command palette.
 * Capped per connection so the local DB doesn't grow without bound.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { QueryHistoryEntry } from '@shared/types/connection'

/** Entries kept per connection. Older ones are pruned on insert. */
export const HISTORY_LIMIT = 1000

interface Row {
  id: number
  connection_id: string | null
  sql: string
  executed_at: string
  duration_ms: number | null
  row_count: number | null
  error: string | null
}

export class QueryHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  add(entry: Omit<QueryHistoryEntry, 'id' | 'executedAt'>): void {
    this.db
      .prepare(
        'INSERT INTO query_history (connection_id, sql, executed_at, duration_ms, row_count, error) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(entry.connectionId, entry.sql, new Date().toISOString(), entry.durationMs, entry.rowCount, entry.error)
    this.db
      .prepare(
        `DELETE FROM query_history WHERE connection_id IS ? AND id NOT IN (
           SELECT id FROM query_history WHERE connection_id IS ? ORDER BY id DESC LIMIT ?)`
      )
      .run(entry.connectionId, entry.connectionId, HISTORY_LIMIT)
  }

  list(connectionId: string | null, limit = 200): QueryHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM query_history WHERE connection_id IS ? ORDER BY id DESC LIMIT ?')
      .all(connectionId, limit) as unknown as Row[]
    return rows.map((r) => ({
      id: r.id,
      connectionId: r.connection_id,
      sql: r.sql,
      executedAt: r.executed_at,
      durationMs: r.duration_ms,
      rowCount: r.row_count,
      error: r.error
    }))
  }
}
