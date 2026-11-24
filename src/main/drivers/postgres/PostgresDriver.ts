/**
 * PostgreSQL implementation of DatabaseDriver (node-postgres).
 *
 * Connection model:
 * - One `pg.Pool` per session, for introspection and commits.
 * - One pinned "console" client for executeQuery, so the SQL editor behaves
 *   like psql: `SET search_path`, temp tables and `BEGIN` persist across
 *   runs. If it dies, it is discarded and the next run gets a fresh one.
 *
 * Read-only (ADR-003): `SET default_transaction_read_only = ON|OFF` is synced
 * on EVERY checkout (always re-asserted while locked), so clients opened
 * before or after the toggle all obey it. While locked, SQL that tries to flip
 * the setting back (or `BEGIN READ WRITE`) is rejected before it is sent.
 */
import pg from 'pg'
import type {
  CellValue,
  ColumnInfo,
  CommitResult,
  DatabaseDriver,
  DriverCapabilities,
  DriverConnectionConfig,
  ExplainResult,
  ForeignKeyInfo,
  PreparedStatement,
  QueryResult,
  SchemaInfo,
  SchemaObjects,
  SchemaSnapshot,
  SelectRowsOptions,
  StagedChangeset,
  TableDetails,
  TableInfo
} from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'
import type { DriverDeps } from '../types'
import { buildBrowseSql, buildCountSql, ESTIMATE_SQL } from './browseSql'
import * as catalog from './catalog'
import { loadTableDetails } from './tableDetails'
import { loadSchemaSnapshot } from './schemaSnapshot'
import { listSchemaObjects, objectDefinition } from './schemaObjects'
import { buildChangesetStatements } from './changesetSql'
import { TYPE_NAMES_SQL } from './introspection'
import { buildPoolConfig } from './pgConfig'
import { runInTransaction } from './commit'
import { runExplain } from './explain'
import { withPgErrors, type PgErrorContext } from './pgErrors'
import { READ_WRITE_ESCAPE, ReadOnlyTracker } from './readOnly'
import { StatementTimeoutTracker } from './statementTimeout'

/** The subset of pg we use. Injected so tests can run without a server. */
export interface PgPoolLike {
  connect(): Promise<pg.PoolClient>
  end(): Promise<void>
  on(event: 'error', listener: (err: Error) => void): unknown
}
export type PoolFactory = (config: pg.PoolConfig) => PgPoolLike

export { MAX_RESULT_ROWS } from './catalog'

export class PostgresDriver implements DatabaseDriver {
  readonly engine = 'postgres' as const
  readonly capabilities: DriverCapabilities = {
    supportsSchemas: true,
    supportsTransactions: true,
    supportsReadOnlySession: true,
    supportsExplain: true,
    supportsCancel: true
  }

  private pool: PgPoolLike | null = null
  private consoleClient: pg.PoolClient | null = null
  private readonly ro = new ReadOnlyTracker()
  private readonly timeout = new StatementTimeoutTracker()
  /** Backend pid of the console client, for pg_cancel_backend. */
  private consolePid: number | null = null
  private consoleBusy = false
  private typeNames = new Map<number, string>()
  private ctx: PgErrorContext = { iam: false, user: '', host: '' }

  constructor(
    private readonly deps: DriverDeps,
    private readonly poolFactory: PoolFactory = (cfg) => new pg.Pool(cfg)
  ) {}

  async connect(config: DriverConnectionConfig): Promise<void> {
    await this.disconnect()
    this.ctx = { iam: config.auth.kind === 'rds-iam', user: config.auth.user, host: config.tls.servername ?? config.host }
    this.ro.enabled = config.readOnly
    this.timeout.ms = config.statementTimeoutMs
    const pool = this.poolFactory(await this.poolConfig(config))
    // An idle client dropped by the server (or a dead tunnel) emits 'error' on
    // the pool. Without a listener, that would crash the main process.
    pool.on('error', () => {})
    this.pool = pool
    try {
      await this.loadTypeNames()
    } catch (err) {
      await this.disconnect()
      throw err
    }
  }

  async disconnect(): Promise<void> {
    const pool = this.pool
    this.pool = null
    this.dropConsoleClient()
    if (pool) await pool.end().catch(() => {})
  }

  setStatementTimeout(ms: number): void {
    // Applied lazily at the next checkout. A SET on the busy console client would queue behind the running query.
    this.timeout.ms = ms
  }

  async explain(sql: string, { analyze }: { analyze: boolean }): Promise<ExplainResult> {
    if (this.ro.enabled && READ_WRITE_ESCAPE.test(sql)) {
      throw new AppErrorException({ code: 'DB_READ_ONLY', message: 'Changing transaction read/write mode is blocked while the session is locked.' })
    }
    return this.withClient((c) => runExplain(c, sql, analyze))
  }

  async ping(): Promise<number> {
    const started = performance.now()
    await this.withClient((c) => c.query('SELECT 1'))
    return Math.round(performance.now() - started)
  }

  async cancelQuery(): Promise<boolean> {
    const pid = this.consolePid
    if (!pid || !this.consoleBusy) return false
    // Must use a different connection: the console client is busy running the query.
    return this.withClient(async (c) => (await c.query<{ ok: boolean }>('SELECT pg_cancel_backend($1) AS ok', [pid])).rows[0]?.ok === true)
  }

  async testConnection(config: DriverConnectionConfig): Promise<{ serverVersion: string }> {
    const ctx: PgErrorContext = { iam: config.auth.kind === 'rds-iam', user: config.auth.user, host: config.tls.servername ?? config.host }
    const pool = this.poolFactory({ ...(await this.poolConfig(config)), max: 1 })
    pool.on('error', () => {})
    try {
      return await withPgErrors(ctx, async () => {
        const client = await pool.connect()
        try {
          const res = await client.query<{ server_version: string }>('SHOW server_version')
          return { serverVersion: res.rows[0]?.server_version ?? 'unknown' }
        } finally {
          client.release()
        }
      })
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async setReadOnly(enabled: boolean): Promise<void> {
    this.ro.enabled = enabled
    // Apply to the console client now, so the toolbar state is true immediately.
    // Pool clients are synced at their next checkout.
    if (this.consoleClient) await this.ro.sync(this.consoleClient)
  }

  async executeQuery(sql: string, params: CellValue[] = []): Promise<QueryResult> {
    if (this.ro.enabled && READ_WRITE_ESCAPE.test(sql)) {
      throw new AppErrorException({
        code: 'DB_READ_ONLY',
        message: 'Changing transaction read/write mode is blocked while the session is locked.',
        hint: 'Use the read-only toggle in the toolbar instead.'
      })
    }
    return withPgErrors(this.ctx, async () => {
      const client = await this.getConsoleClient()
      this.consoleBusy = true
      const started = performance.now()
      let raw: pg.QueryArrayResult | pg.QueryArrayResult[]
      try {
        raw = (await client.query({ text: sql, values: params, rowMode: 'array' })) as
          | pg.QueryArrayResult
          | pg.QueryArrayResult[]
      } catch (err) {
        // A connection-level failure leaves the client unusable. Drop it.
        if (!(err as { code?: string }).code || /terminat/i.test(String(err))) this.dropConsoleClient()
        throw err
      } finally {
        this.consoleBusy = false
      }
      // Multi-statement simple queries return one result per statement: keep them all,
      // and mirror the last at the top level (what single-result callers expect).
      const durationMs = Math.round(performance.now() - started)
      const shape = (r: pg.QueryArrayResult): QueryResult => catalog.toQueryResult(r, durationMs, (oid) => this.typeName(oid))
      if (!Array.isArray(raw)) return shape(raw)
      const all = raw.map(shape)
      return { ...(all[all.length - 1] as QueryResult), statements: all }
    })
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    return this.withClient((c) => catalog.listSchemas(c))
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    return this.withClient((c) => catalog.listTables(c, schema))
  }

  async getTableColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    return this.withClient((c) => catalog.tableColumns(c, schema, table))
  }

  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    return this.withClient((c) => catalog.primaryKeys(c, schema, table))
  }

  async countRows(schema: string, table: string, { exact, where }: { exact: boolean; where?: string }): Promise<{ count: number | null; exact: boolean }> {
    if (!exact) {
      const est = await this.withClient(async (c) => (await c.query<{ n: number }>(ESTIMATE_SQL, [schema, table])).rows[0]?.n)
      return { count: est === undefined || est < 0 ? null : Math.round(est), exact: false }
    }
    if (this.ro.enabled && where && READ_WRITE_ESCAPE.test(where)) {
      throw new AppErrorException({ code: 'DB_READ_ONLY', message: 'That filter tries to change read/write mode, which is blocked while locked.' })
    }
    const n = await this.withClient(async (c) => (await c.query<{ n: string }>(buildCountSql({ schema, table, where }), [1])).rows[0]?.n)
    return { count: n === undefined ? null : Number(n), exact: true }
  }

  async getForeignKeys(schema: string, table: string): Promise<{ outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] }> {
    return this.withClient((c) => catalog.foreignKeys(c, schema, table))
  }

  async listSchemaObjects(schema: string): Promise<SchemaObjects> {
    return this.withClient((c) => listSchemaObjects(c, schema))
  }

  async getObjectDefinition(kind: 'function' | 'sequence' | 'type', id: string): Promise<string> {
    return this.withClient((c) => objectDefinition(c, kind, id))
  }

  async getSchemaSnapshot(): Promise<SchemaSnapshot> {
    return this.withClient((c) => loadSchemaSnapshot(c))
  }

  async getTableDetails(schema: string, table: string): Promise<TableDetails> {
    return this.withClient((c) => loadTableDetails(c, schema, table))
  }

  async selectRows(schema: string, table: string, { limit, offset, where, orderBy }: SelectRowsOptions): Promise<QueryResult> {
    if (this.ro.enabled && READ_WRITE_ESCAPE.test(`${where ?? ''}\n${orderBy ?? ''}`)) {
      throw new AppErrorException({ code: 'DB_READ_ONLY', message: 'That filter tries to change read/write mode, which is blocked while locked.' })
    }
    const primaryKey = await this.getPrimaryKeys(schema, table)
    const sql = buildBrowseSql({ schema, table, primaryKey, where, orderBy })
    return this.withClient(async (c) => {
      const started = performance.now()
      const res = await c.query({ text: sql, values: [limit, offset], rowMode: 'array' })
      return catalog.toQueryResult(res, Math.round(performance.now() - started), (oid) => this.typeName(oid))
    })
  }

  previewChanges(changeset: StagedChangeset): PreparedStatement[] {
    return buildChangesetStatements(changeset)
  }

  async commitChanges(changeset: StagedChangeset): Promise<CommitResult> {
    if (this.ro.enabled) {
      throw new AppErrorException({
        code: 'DB_READ_ONLY',
        message: 'Cannot commit changes: the session is read-only.',
        hint: 'Unlock the read-only toggle in the toolbar first.'
      })
    }
    const statements = this.previewChanges(changeset)
    return this.withClient((c) => runInTransaction(c, statements))
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async poolConfig(config: DriverConnectionConfig): Promise<pg.PoolConfig> {
    const password =
      config.auth.kind === 'rds-iam'
        ? this.deps.iamPasswordProvider(config.auth)
        : await this.deps.resolvePassword(config.auth.secretRef)
    return buildPoolConfig({ config, password, rdsCaBundle: () => this.deps.rdsCaBundle() })
  }

  private requirePool(): PgPoolLike {
    if (!this.pool) throw new AppErrorException({ code: 'DB_CONNECTION_FAILED', message: 'Not connected.' })
    return this.pool
  }

  /** Checks out a pool client with read-only state synced, and always releases it. */
  private async withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withPgErrors(this.ctx, async () => {
      const client = await this.requirePool().connect()
      let broken = false
      try {
        await this.ro.sync(client)
        this.timeout.assume(client, this.timeout.ms)
        await this.timeout.sync(client)
        return await fn(client)
      } catch (err) {
        broken = !(err instanceof AppErrorException) && !(err as { code?: string }).code
        throw err
      } finally {
        client.release(broken)
      }
    })
  }

  private async getConsoleClient(): Promise<pg.PoolClient> {
    if (!this.consoleClient) {
      const client = await this.requirePool().connect()
      client.on('error', () => this.dropConsoleClient())
      this.consoleClient = client
      this.timeout.assume(client, this.timeout.ms)
      this.consolePid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid ?? null
    }
    await this.ro.sync(this.consoleClient)
    await this.timeout.sync(this.consoleClient)
    return this.consoleClient
  }

  private dropConsoleClient(): void {
    this.consoleClient?.release(true)
    this.consoleClient = null
    this.consolePid = null
  }

  private async loadTypeNames(): Promise<void> {
    const rows = await this.withClient(async (c) => (await c.query<{ oid: number; name: string }>(TYPE_NAMES_SQL)).rows)
    this.typeNames = new Map(rows.map((r) => [r.oid, r.name]))
  }

  private typeName(oid: number): string {
    return this.typeNames.get(oid) ?? `oid:${oid}`
  }
}
