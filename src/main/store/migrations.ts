/**
 * Schema migrations for the local ViewDeck database, tracked with
 * `PRAGMA user_version`. Append only: never edit a shipped migration, add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // v1
  `
  CREATE TABLE connections (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    engine       TEXT NOT NULL,
    config_json  TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    last_used_at TEXT
  );

  -- safeStorage-encrypted blobs only. Never plaintext (AGENTS.md invariant 6).
  CREATE TABLE secrets (
    ref        TEXT PRIMARY KEY,
    ciphertext BLOB NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE query_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    sql           TEXT NOT NULL,
    executed_at   TEXT NOT NULL,
    duration_ms   INTEGER,
    row_count     INTEGER,
    error         TEXT
  );
  CREATE INDEX query_history_conn_time ON query_history (connection_id, executed_at DESC);

  CREATE TABLE preferences (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  // v2: starred / saved queries (connection_id NULL = available on every connection)
  `
  CREATE TABLE saved_queries (
    id            TEXT PRIMARY KEY,
    connection_id TEXT,
    name          TEXT NOT NULL,
    sql           TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX saved_queries_conn ON saved_queries (connection_id, name);
  `
]
