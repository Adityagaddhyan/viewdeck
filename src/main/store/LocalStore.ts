/**
 * Local persistence on Node's built-in `node:sqlite` (ADR-001: no native
 * module to rebuild for each Electron ABI).
 *
 * File: `<userData>/viewdeck.sqlite`. The store holds saved connections,
 * encrypted secrets, query history and preferences. WAL mode keeps the
 * synchronous API from blocking reads behind writes. Every call is
 * synchronous but sub-millisecond at our data sizes, which is acceptable in
 * the main process.
 */
import { DatabaseSync } from 'node:sqlite'
import { ConnectionRepository } from './ConnectionRepository'
import { MIGRATIONS } from './migrations'
import { PreferencesRepository } from './PreferencesRepository'
import { QueryHistoryRepository } from './QueryHistoryRepository'
import { SavedQueryRepository } from './SavedQueryRepository'
import { SecretStore, type SafeStorageLike } from './SecretStore'

export class LocalStore {
  readonly db: DatabaseSync
  readonly connections: ConnectionRepository
  readonly secrets: SecretStore
  readonly history: QueryHistoryRepository
  readonly preferences: PreferencesRepository
  readonly savedQueries: SavedQueryRepository

  /** @param path File path, or ':memory:' for tests. */
  constructor(path: string, safeStorage: SafeStorageLike) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
    migrate(this.db)
    this.connections = new ConnectionRepository(this.db)
    this.secrets = new SecretStore(this.db, safeStorage)
    this.history = new QueryHistoryRepository(this.db)
    this.preferences = new PreferencesRepository(this.db)
    this.savedQueries = new SavedQueryRepository(this.db)
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}

/** Applies pending migrations, each in its own transaction. */
export function migrate(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  let version = row?.user_version ?? 0
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version] as string
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    version++
  }
  return version
}
