/** Key/value preferences stored as JSON (theme, last profile/region, editor settings…). */
import type { DatabaseSync } from 'node:sqlite'

export class PreferencesRepository {
  constructor(private readonly db: DatabaseSync) {}

  get<T = unknown>(key: string): T | null {
    const row = this.db.prepare('SELECT value_json FROM preferences WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined
    return row ? (JSON.parse(row.value_json) as T) : null
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
      )
      .run(key, JSON.stringify(value ?? null))
  }
}
