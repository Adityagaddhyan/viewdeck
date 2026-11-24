/**
 * Engine-agnostic database driver contract.
 *
 * Every engine (Postgres today; MySQL, ClickHouse, SQLite, DynamoDB later)
 * implements {@link DatabaseDriver} in `src/main/drivers/<engine>/` and
 * registers in `DriverFactory`. The UI and AWS layers only ever see these
 * types, so adding an engine never touches the renderer or `src/main/aws/`.
 *
 * Everything here must stay structured-clone serializable (no class
 * instances, functions, Buffers or BigInts in values crossing IPC), because
 * results travel main → renderer over `ipcMain.handle`.
 *
 * See docs/ADDING_A_DATABASE.md.
 */

/** Registered engine identifiers. Extend this union when adding a driver. */
import type { SchemaGraph } from './diagram'

export type DatabaseEngine = 'postgres'

/** Static feature flags the UI reads to show or hide engine-specific features. */
export interface DriverCapabilities {
  /** Engine has a namespace level between database and table (Postgres schemas). */
  supportsSchemas: boolean
  /** `commitChanges` can wrap a changeset in an atomic transaction. */
  supportsTransactions: boolean
  /** `setReadOnly` is enforced by the server, not just by the client. */
  supportsReadOnlySession: boolean
  /** `EXPLAIN`-style plans are available. */
  supportsExplain: boolean
  /** A running editor query can be cancelled (`cancelQuery`). */
  supportsCancel: boolean
  /** `getSchemaGraph` returns tables + foreign keys for the ER diagram. */
  supportsSchemaGraph: boolean
}

/** How the driver authenticates. Resolved in main, never sent with secrets to the renderer. */
export type DriverAuth =
  | {
      kind: 'password'
      user: string
      /** Reference to a keychain-encrypted secret in LocalStore. Never plaintext on disk. */
      secretRef: string
    }
  | {
      kind: 'rds-iam'
      user: string
      awsProfile: string
      region: string
      /**
       * The REAL RDS endpoint and port the token is signed for. These differ from
       * `DriverConnectionConfig.host/port` when connecting through an SSM tunnel
       * (127.0.0.1:<local port>), and RDS rejects tokens signed for the wrong host.
       */
      rdsHost: string
      rdsPort: number
    }

/** TLS settings. `servername` is needed when connecting through a localhost tunnel. */
export interface DriverTlsConfig {
  mode: 'disable' | 'require' | 'verify-full'
  /**
   * Hostname to verify the server certificate against (SNI). Over an SSM
   * tunnel the socket targets 127.0.0.1, but the RDS cert is issued for the
   * real endpoint, so `verify-full` needs the original RDS hostname here.
   */
  servername?: string
  /** Use the bundled AWS RDS global CA bundle. */
  useRdsCaBundle?: boolean
}

/** Resolved connection parameters handed to `connect()`. */
export interface DriverConnectionConfig {
  engine: DatabaseEngine
  /** Socket host: the RDS endpoint, or 127.0.0.1 when tunnelled. */
  host: string
  port: number
  database: string
  auth: DriverAuth
  tls: DriverTlsConfig
  /** Start the session read-only (prod default). */
  readOnly: boolean
  /** Server-side statement timeout in ms (0 = off). Defaults come from the environment tier. */
  statementTimeoutMs: number
}

export interface SchemaInfo {
  name: string
}

export interface TableInfo {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized-view'
}

export interface ColumnInfo {
  name: string
  /** Engine-native type name, e.g. `timestamptz`. */
  dataType: string
  nullable: boolean
  defaultValue: string | null
  ordinal: number
  isPrimaryKey: boolean
  /** Allowed labels when the column is an enum type (in declared order), else null. */
  enumValues: string[] | null
}

/** Grid-safe cell value. Drivers normalise engine types (bigint, bytea, dates) into these. */
export type CellValue = string | number | boolean | null

export interface QueryField {
  name: string
  dataType: string
}

export interface QueryResult {
  fields: QueryField[]
  rows: CellValue[][]
  /** Rows affected (DML) or returned (SELECT). */
  rowCount: number
  /** Server command tag, e.g. `SELECT`, `UPDATE`. */
  command: string
  durationMs: number
  /** True when the driver capped the rows it returned. */
  truncated: boolean
  /** Every statement's result when one run executed several (this object mirrors the last). */
  statements?: QueryResult[]
}

/** Identifies a row by its primary-key column values. */
export type RowKey = Record<string, CellValue>

/** One staged grid edit. Built in the renderer, turned into SQL by the driver. */
export type StagedChange =
  | { kind: 'update'; key: RowKey; values: Record<string, CellValue> }
  | { kind: 'insert'; values: Record<string, CellValue> }
  | { kind: 'delete'; key: RowKey }

/** All pending edits for one table, committed atomically. */
export interface StagedChangeset {
  schema: string
  table: string
  changes: StagedChange[]
}

/** Paging and filter options for `selectRows` (the table browser). */
export interface SelectRowsOptions {
  limit: number
  offset: number
  /**
   * Engine-native condition typed in the grid's filter bar, without the
   * `WHERE` keyword (e.g. `status = 'OPEN' and amount > 10`). Raw SQL by design.
   * Drivers must contain it (parenthesise it, keep it out of LIMIT/OFFSET) and
   * honour read-only.
   */
  where?: string
  /** Engine-native sort expression without `ORDER BY`. Replaces the default PK order. */
  orderBy?: string
}

/**
 * Whole-catalog snapshot for instant autocomplete and the explorer: every
 * user-visible schema, table and column, fetched in one round trip and cached
 * per connection. Columnar `[name, type]` pairs keep the IPC payload small on
 * catalogs with tens of thousands of columns.
 */
export interface SchemaSnapshot {
  schemas: string[]
  /** Unqualified names resolve against these schemas, in order (Postgres search_path). */
  searchPath: string[]
  tables: Array<{ schema: string; name: string; kind: TableInfo['kind']; columns: Array<[name: string, type: string]>; rowEstimate?: number | null }>
  /** True when the catalog was larger than the snapshot cap (lazy per-table loads still work). */
  truncated: boolean
  takenAt: string
}

/** EXPLAIN output for the plan visualiser (`plan` is the engine's JSON plan). */
export interface ExplainResult {
  plan: unknown
  analyzed: boolean
  durationMs: number
}

/** Non-table objects in a schema, for the sidebar. */
export interface SchemaObjects {
  functions: Array<{ id: string; name: string; signature: string; returns: string; kind: 'function' | 'procedure' | 'aggregate' | 'window' }>
  sequences: Array<{ id: string; name: string }>
  types: Array<{ id: string; name: string; kind: 'enum' | 'domain' | 'composite' | 'range' }>
}

/** A foreign key: `schema.table(columns)` references `refSchema.refTable(refColumns)`. */
export interface ForeignKeyInfo {
  name: string
  schema: string
  table: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

/** One index on a table. Size and scan counts are null when the engine can't say. */
export interface IndexInfo {
  name: string
  /** Full engine-native definition, e.g. `CREATE UNIQUE INDEX … USING btree (…)`. */
  definition: string
  unique: boolean
  primary: boolean
  sizeBytes: number | null
  /** Times the index has been used since statistics were last reset. */
  scans: number | null
}

export interface ConstraintInfo {
  name: string
  /** Human label: primary key, unique, foreign key, check, exclusion. */
  type: string
  definition: string
}

/**
 * Everything the table info panel (ⓘ) shows. Engine-agnostic: `stats` is
 * display-ready label/value pairs, so each driver reports what its engine has
 * (sizes, row estimates, vacuum times…) without new UI code.
 */
export interface TableDetails {
  kind: TableInfo['kind'] | 'partitioned-table' | 'foreign-table'
  owner: string | null
  comment: string | null
  /** Reconstructed CREATE statement(s), or null if the engine can't produce one. */
  ddl: string | null
  stats: Array<{ label: string; value: string; hint?: string }>
  indexes: IndexInfo[]
  constraints: ConstraintInfo[]
  /** Foreign keys in OTHER tables that point at this one. */
  referencedBy: Array<{ name: string; table: string; definition: string }>
  triggers: Array<{ name: string; definition: string }>
}

/** A parameterized statement for the SQL diff preview, and for execution. */
export interface PreparedStatement {
  sql: string
  params: CellValue[]
  /**
   * Exact row count this statement must affect, or the whole commit rolls back.
   * UPDATE and DELETE by primary key expect 1, which guards against a row that
   * was changed or deleted by someone else since it was loaded.
   */
  expectRows?: number
}

export interface CommitResult {
  statementsExecuted: number
  rowsAffected: number
}

/**
 * Implemented once per engine. Instances are stateful (they own a pool) and
 * live in the main process only.
 */
export interface DatabaseDriver {
  readonly engine: DatabaseEngine
  readonly capabilities: DriverCapabilities

  connect(config: DriverConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  /** Opens a connection, runs a trivial query and closes it. Does not keep a pool. */
  testConnection(config: DriverConnectionConfig): Promise<{ serverVersion: string }>
  /** Toggles server-enforced read-only mode for all current and future pooled sessions. */
  setReadOnly(enabled: boolean): Promise<void>
  /** Changes the statement timeout (ms, 0 = off). Applied at the next checkout of each connection. */
  setStatementTimeout(ms: number): void
  /**
   * Query plan for ONE statement. `analyze` executes it inside a transaction
   * that is always rolled back, so writes never persist.
   */
  explain(sql: string, opts: { analyze: boolean }): Promise<ExplainResult>
  /** Round-trip latency in ms using a pool connection (never queues behind the editor's query). */
  ping(): Promise<number>
  /** Cancels the query running on the editor connection. Resolves false if nothing was running. */
  cancelQuery(): Promise<boolean>
  executeQuery(sql: string, params?: CellValue[]): Promise<QueryResult>
  listSchemas(): Promise<SchemaInfo[]>
  listTables(schema: string): Promise<TableInfo[]>
  getTableColumns(schema: string, table: string): Promise<ColumnInfo[]>
  getPrimaryKeys(schema: string, table: string): Promise<string[]>
  /**
   * Row count for the pager. `exact: false` returns the planner estimate (cheap,
   * ignores `where`). `exact: true` runs COUNT(*) honouring the filter-bar `where`.
   * `count` is null when no estimate exists (table never analyzed).
   */
  countRows(schema: string, table: string, opts: { exact: boolean; where?: string }): Promise<{ count: number | null; exact: boolean }>
  /** FKs out of this table (outgoing) and from other tables into it (incoming), for row navigation. */
  getForeignKeys(schema: string, table: string): Promise<{ outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] }>
  /** Functions, sequences and user types in a schema (sidebar). */
  listSchemaObjects(schema: string): Promise<SchemaObjects>
  /** Reconstructed CREATE statement for a function / sequence / type id from listSchemaObjects. */
  getObjectDefinition(kind: 'function' | 'sequence' | 'type', id: string): Promise<string>
  /** Every schema, table and column in one call (autocomplete / explorer cache). */
  getSchemaSnapshot(): Promise<SchemaSnapshot>
  /** Tables, columns, keys and every foreign key touching `schema` (ER diagram). */
  getSchemaGraph(schema: string): Promise<SchemaGraph>
  /** DDL, indexes, constraints, triggers and engine stats for the table info panel. */
  getTableDetails(schema: string, table: string): Promise<TableDetails>
  /**
   * Browses a table for the grid: all columns, stable order (primary key if any),
   * LIMIT/OFFSET paging. The driver quotes identifiers, so the renderer never builds SQL.
   */
  selectRows(schema: string, table: string, options: SelectRowsOptions): Promise<QueryResult>
  /** Builds the exact statements `commitChanges` would run, for the diff preview. */
  previewChanges(changeset: StagedChangeset): PreparedStatement[]
  /** Runs the changeset in one transaction. Rolls back everything on any failure. */
  commitChanges(changeset: StagedChangeset): Promise<CommitResult>
}
