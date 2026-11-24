# Adding a Database Engine

ViewDeck's UI and AWS layers are engine-agnostic. A new engine (MySQL, ClickHouse,
SQLite, DynamoDB…) is **one folder plus one registration line**. If you find yourself
editing `src/renderer` or `src/main/aws` to add an engine, stop. Extend
`DriverCapabilities` instead, and let the UI branch on capabilities.

The contract lives in [`src/shared/types/driver.ts`](../src/shared/types/driver.ts).

> Reference implementation: [`src/main/drivers/postgres/`](../src/main/drivers/postgres/).
> It shows the expected split: `PostgresDriver.ts` (lifecycle and queries),
> `pgConfig.ts` (pure config/TLS), `changesetSql.ts` (pure SQL generation),
> `introspection.ts` (catalog SQL), `typeParsers.ts` (value normalisation),
> `pgErrors.ts` (error mapping), plus unit tests and a skip-if-no-server
> `PostgresDriver.integration.test.ts`.

## Steps

### 1. Register the engine id

```ts
// src/shared/types/driver.ts
export type DatabaseEngine = 'postgres' | 'mysql'
```

### 2. Add the client library (main process only)

```sh
npm i mysql2
```

Never import it from `src/renderer` or `src/shared`.

### 3. Implement `DatabaseDriver`

Create `src/main/drivers/mysql/MySqlDriver.ts`. Split it into helpers once it nears
300 lines: `introspection.ts`, `changesetSql.ts`, `valueCodec.ts`.

```ts
import type {
  CellValue, ColumnInfo, CommitResult, DatabaseDriver, DriverCapabilities,
  DriverConnectionConfig, PreparedStatement, QueryResult, SchemaInfo, SelectRowsOptions, TableDetails,
  StagedChangeset, TableInfo
} from '@shared/types/driver'

/**
 * MySQL driver.
 * - MySQL "schemas" are databases, so supportsSchemas maps listSchemas() → SHOW DATABASES.
 * - Read-only uses `SET SESSION TRANSACTION READ ONLY`, applied on every pool connection.
 */
export class MySqlDriver implements DatabaseDriver {
  readonly engine = 'mysql' as const
  readonly capabilities: DriverCapabilities = {
    supportsSchemas: true,
    supportsTransactions: true,
    supportsReadOnlySession: true,
    supportsExplain: true
  }

  async connect(config: DriverConnectionConfig): Promise<void> { /* create pool */ }
  async disconnect(): Promise<void> { /* end pool; idempotent */ }
  async testConnection(config: DriverConnectionConfig) { return { serverVersion: '' } }
  async setReadOnly(enabled: boolean): Promise<void> { /* see "Read-only" below */ }
  async executeQuery(sql: string, params: CellValue[] = []): Promise<QueryResult> { /* … */ }
  async listSchemas(): Promise<SchemaInfo[]> { /* … */ }
  async listTables(schema: string): Promise<TableInfo[]> { /* … */ }
  async getTableColumns(schema: string, table: string): Promise<ColumnInfo[]> { /* … */ }
  async getPrimaryKeys(schema: string, table: string): Promise<string[]> { /* … */ }
  async selectRows(schema: string, table: string, o: SelectRowsOptions): Promise<QueryResult> { /* PK-ordered page; contain o.where / o.orderBy */ }
  async getTableDetails(schema: string, table: string): Promise<TableDetails> { /* stats as label/value; ddl may be null */ }
  previewChanges(cs: StagedChangeset): PreparedStatement[] { /* pure: no I/O */ }
  async commitChanges(cs: StagedChangeset): Promise<CommitResult> { /* BEGIN … COMMIT */ }
}
```

### 4. Register it in `DriverFactory`

```ts
// src/main/drivers/DriverFactory.ts
const REGISTRY: Record<DatabaseEngine, (deps: DriverDeps) => DatabaseDriver> = {
  postgres: (deps) => new PostgresDriver(deps),
  mysql: (deps) => new MySqlDriver(deps)
}
```

Drivers get credentials only through `DriverDeps` (`src/main/drivers/types.ts`):
`resolvePassword(secretRef)`, `iamPasswordProvider(auth)` (call it per connection)
and `rdsCaBundle()`. Never import AWS, safeStorage, or LocalStore from a driver.
`SessionManager` / `resolveConnection` handle tunnels and environment, so a driver
only ever sees a `DriverConnectionConfig`.

TypeScript makes this exhaustive: adding to `DatabaseEngine` without registering it is
a compile error.

### 5. Test

Co-locate `MySqlDriver.test.ts`. At minimum, unit-test the pure parts with no
database: `previewChanges` SQL and parameter order, identifier quoting, and value
normalisation. Integration tests against a Docker container are optional and must
skip when the container is not reachable.

### 6. Update docs

- `AGENTS.md`: repo layout.
- `ARCHITECTURE.md`: module map.
- This file: anything engine-specific that surprised you.

## Behavioural requirements (every driver)

| Requirement | Why |
| --- | --- |
| **All user values are bound parameters.** Never interpolate values into SQL. | SQL injection. The diff preview shows the parameters too. |
| **Identifiers are quoted by the driver** (`"col"` for PG, `` `col` `` for MySQL), with embedded quotes escaped. | Table and column names come from user data. |
| **`previewChanges` and `commitChanges` produce identical SQL.** `commitChanges` should call `previewChanges`. | The preview is a promise to the user about exactly what will run (ADR-003). |
| **`commitChanges` is all-or-nothing.** Roll back on any error. If `supportsTransactions` is false, the UI must warn before commit. | No partial writes. |
| **UPDATE and DELETE target rows by primary key only.** Refuse to build them for tables without a PK. Inserts are fine. | Avoids ambiguous multi-row edits. |
| **Normalise values to `CellValue`**: bigint/numeric → string, bytes → `\x…` hex string, dates → ISO string, JSON → string. | IPC is structured-clone only, and JS numbers lose precision. |
| **Read-only is server-enforced when `supportsReadOnlySession`**, and applies to *all* pooled connections, including ones opened later. | A client-only flag is not a safety guarantee. |
| **`disconnect()` is idempotent** and releases every socket. | It is called from quit hooks and from error paths. |
| **IAM / token auth uses a per-connection password callback.** Never sign once and cache. | RDS IAM tokens expire after 15 minutes (ADR-002). |
| **TLS honours `tls.servername`.** | Connections over SSM tunnels go to 127.0.0.1 but must verify the RDS hostname. |
| **Throw `AppErrorException`** with `DB_AUTH_FAILED`, `DB_CONNECTION_FAILED`, `DB_QUERY_FAILED` or `DB_READ_ONLY`, and a `hint`. | The UI maps codes to remediation banners. |

## Engine notes

- **MySQL / Aurora MySQL:** IAM auth uses the same `@aws-sdk/rds-signer`. The client must
  send the token as a cleartext password over TLS (the `mysql_clear_password` plugin).
- **ClickHouse:** no real transactions, so set `supportsTransactions: false`. Read-only
  is the `readonly=1` setting per query or session.
- **SQLite:** no AWS, no tunnel. `supportsSchemas: false`, and the UI hides the schema
  level. Use `node:sqlite` (already a dependency for LocalStore).
- **DynamoDB:** not SQL. It will likely need a `supportsSql: false` capability and a
  separate query surface. Write an ADR before starting.
