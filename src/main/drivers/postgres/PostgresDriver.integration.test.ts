/**
 * PostgresDriver against a real server. Skipped unless these env vars are set:
 *
 *   VIEWDECK_PG_TEST_PORT      e.g. 55432 (server on 127.0.0.1, TLS enabled)
 *   VIEWDECK_PG_TEST_PASSWORD  password for user `postgres` (SCRAM auth)
 *   VIEWDECK_PG_TEST_CA        PEM of the CA that signed a server cert for
 *                              DNS:db.viewdeck.test
 *
 * The server cert names `db.viewdeck.test` but we connect to 127.0.0.1, which
 * is exactly the SSM-tunnel situation. These tests prove `servername` + `ca`
 * give working verify-full TLS through a localhost hop, and that the password
 * callback runs once per physical connection (the RDS IAM token contract).
 * See AGENTS.md § Commands for a one-liner that starts such a server.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DriverConnectionConfig } from '@shared/types/driver'
import type { DriverDeps } from '../types'
import { PostgresDriver } from './PostgresDriver'

const PORT = Number(process.env['VIEWDECK_PG_TEST_PORT'] ?? 0)
const PASSWORD = process.env['VIEWDECK_PG_TEST_PASSWORD'] ?? ''
const CA_PATH = process.env['VIEWDECK_PG_TEST_CA'] ?? ''
const enabled = PORT > 0 && PASSWORD !== '' && CA_PATH !== ''

function setup(overrides: Partial<DriverConnectionConfig> = {}, password = PASSWORD) {
  let passwordCalls = 0
  const deps: DriverDeps = {
    resolvePassword: async () => password,
    // Simulates the RDS IAM provider: count calls to prove per-connection signing.
    iamPasswordProvider: () => async () => {
      passwordCalls++
      return password
    },
    rdsCaBundle: () => readFileSync(CA_PATH, 'utf8')
  }
  const config: DriverConnectionConfig = {
    engine: 'postgres',
    host: '127.0.0.1',
    port: PORT,
    database: 'postgres',
    auth: { kind: 'rds-iam', user: 'postgres', awsProfile: 'test', region: 'us-east-1', rdsHost: 'db.viewdeck.test', rdsPort: 5432 },
    tls: { mode: 'verify-full', servername: 'db.viewdeck.test', useRdsCaBundle: true },
    readOnly: false,
    statementTimeoutMs: 0,
    ...overrides
  }
  return { driver: new PostgresDriver(deps), config, calls: () => passwordCalls }
}

describe.skipIf(!enabled)('PostgresDriver (integration)', () => {
  const { driver, config, calls } = setup()

  beforeAll(async () => {
    await driver.connect(config)
    await driver.executeQuery(`
      DROP SCHEMA IF EXISTS vd_test CASCADE;
      CREATE SCHEMA vd_test;
      CREATE TABLE vd_test."Orders" (
        tenant text NOT NULL, id int NOT NULL, status text DEFAULT 'new',
        amount numeric(20,2), big int8, at timestamptz, raw bytea, meta jsonb,
        PRIMARY KEY (tenant, id));
      CREATE VIEW vd_test.order_view AS SELECT * FROM vd_test."Orders";
      CREATE TYPE vd_test.mood AS ENUM ('sad', 'ok', 'happy');
      CREATE TABLE vd_test.feelings (id int PRIMARY KEY, mood vd_test.mood);
      CREATE SEQUENCE vd_test.ticket_seq START 100 INCREMENT 5;
      CREATE DOMAIN vd_test.positive AS int CHECK (VALUE > 0);
      CREATE FUNCTION vd_test.add_one(x int) RETURNS int LANGUAGE sql AS 'SELECT x + 1';
      INSERT INTO vd_test."Orders" VALUES
        ('a', 1, 'new', 12345678901234567.25, 9007199254740993, '2026-11-23 12:00:00.123456+00', '\\xdeadbeef', '{"k": 1}'),
        ('a', 2, 'new', 1, 1, null, null, null);`)
  })
  afterAll(async () => {
    await driver.executeQuery('DROP SCHEMA IF EXISTS vd_test CASCADE')
    await driver.disconnect()
  })

  it('verify-full TLS works to 127.0.0.1 via servername + CA, with per-connection password calls', async () => {
    await Promise.all([1, 2, 3, 4].map(() => driver.listTables('vd_test')))
    // Console client + several pool clients, each with its own callback invocation.
    expect(calls()).toBeGreaterThanOrEqual(2)
    const ssl = await driver.executeQuery('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
    expect(ssl.rows[0]?.[0]).toBe(true)
  })

  it('rejects a certificate whose name does not match servername', async () => {
    const bad = setup({ tls: { mode: 'verify-full', servername: 'wrong.example.com', useRdsCaBundle: true } })
    await expect(bad.driver.testConnection(bad.config)).rejects.toMatchObject({ appError: { code: 'DB_CONNECTION_FAILED' } })
  })

  it('maps bad credentials to DB_AUTH_FAILED with an IAM hint', async () => {
    const bad = setup({}, 'nope')
    await expect(bad.driver.testConnection(bad.config)).rejects.toMatchObject({
      appError: { code: 'DB_AUTH_FAILED', command: 'GRANT rds_iam TO "postgres";', steps: expect.arrayContaining([expect.stringContaining('rds_iam')]) }
    })
  })

  it('introspects schemas, tables, columns and ordered composite PKs', async () => {
    expect((await driver.listSchemas()).map((s) => s.name)).toEqual(expect.arrayContaining(['public', 'vd_test']))
    const tables = await driver.listTables('vd_test')
    expect(tables).toHaveLength(3)
    expect(tables).toEqual(
      expect.arrayContaining([
        { schema: 'vd_test', name: 'Orders', kind: 'table' },
        { schema: 'vd_test', name: 'feelings', kind: 'table' },
        { schema: 'vd_test', name: 'order_view', kind: 'view' }
      ])
    )
    const cols = await driver.getTableColumns('vd_test', 'Orders')
    expect(cols[0]).toEqual({ name: 'tenant', dataType: 'text', nullable: false, defaultValue: null, ordinal: 1, isPrimaryKey: true, enumValues: null })
    expect(cols.find((c) => c.name === 'status')).toMatchObject({ defaultValue: "'new'::text", isPrimaryKey: false })
    expect(cols.find((c) => c.name === 'amount')?.dataType).toBe('numeric(20,2)')
    expect(await driver.getPrimaryKeys('vd_test', 'Orders')).toEqual(['tenant', 'id'])
    const mood = (await driver.getTableColumns('vd_test', 'feelings')).find((c) => c.name === 'mood')
    expect(mood).toMatchObject({ dataType: 'vd_test.mood', enumValues: ['sad', 'ok', 'happy'] })
  })

  it('returns exact, IPC-safe values and type names', async () => {
    // timestamptz text follows the session TimeZone; pin it so the assertion is stable.
    await driver.executeQuery("SET TIME ZONE 'UTC'")
    const r = await driver.executeQuery('SELECT amount, big, at, raw, meta, id FROM vd_test."Orders" WHERE id = $1', [1])
    expect(r.fields.map((f) => f.dataType)).toEqual(['numeric', 'int8', 'timestamptz', 'bytea', 'jsonb', 'int4'])
    expect(r.rows[0]).toEqual(['12345678901234567.25', '9007199254740993', '2026-11-23 12:00:00.123456+00', '\\xdeadbeef', '{"k": 1}', 1])
    expect(r).toMatchObject({ command: 'SELECT', rowCount: 1, truncated: false })
  })

  it('selectRows pages in primary-key order with quoted identifiers', async () => {
    const page = await driver.selectRows('vd_test', 'Orders', { limit: 1, offset: 1 })
    expect(page.fields.map((f) => f.name).slice(0, 2)).toEqual(['tenant', 'id'])
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]?.slice(0, 2)).toEqual(['a', 2])
  })

  it('selectRows applies the filter bar WHERE / ORDER BY, contained and read-only safe', async () => {
    const filtered = await driver.selectRows('vd_test', 'Orders', { limit: 10, offset: 0, where: "id = 2 -- trailing comment" })
    expect(filtered.rows.map((r) => r[1])).toEqual([2])
    const sorted = await driver.selectRows('vd_test', 'Orders', { limit: 10, offset: 0, orderBy: 'id desc' })
    expect(sorted.rows.map((r) => r[1])).toEqual([2, 1])
    await expect(
      driver.selectRows('vd_test', 'Orders', { limit: 10, offset: 0, where: 'true; delete from vd_test."Orders"' })
    ).rejects.toMatchObject({ appError: { code: 'DB_QUERY_FAILED' } })
    expect((await driver.selectRows('vd_test', 'Orders', { limit: 10, offset: 0 })).rows).toHaveLength(2)
  })

  it('getTableDetails reconstructs DDL and reports indexes, constraints, FKs and stats', async () => {
    await driver.executeQuery(`
      CREATE INDEX orders_status_idx ON vd_test."Orders" (status);
      COMMENT ON TABLE vd_test."Orders" IS 'test orders';
      CREATE TABLE vd_test.lines (id serial PRIMARY KEY, tenant text, order_id int, FOREIGN KEY (tenant, order_id) REFERENCES vd_test."Orders" (tenant, id));`)
    const d = await driver.getTableDetails('vd_test', 'Orders')
    expect(d.kind).toBe('table')
    expect(d.comment).toBe('test orders')
    expect(d.ddl).toContain('CREATE TABLE "vd_test"."Orders" (')
    expect(d.ddl).toContain(`"status" text DEFAULT 'new'::text`)
    expect(d.ddl).toContain('CONSTRAINT "Orders_pkey" PRIMARY KEY (tenant, id)')
    expect(d.ddl).toContain('CREATE INDEX orders_status_idx ON vd_test."Orders" USING btree (status);')
    expect(d.ddl).not.toMatch(/CREATE UNIQUE INDEX "Orders_pkey"/) // PK index is shown via its constraint
    expect(d.indexes.map((i) => [i.name, i.primary])).toEqual([['Orders_pkey', true], ['orders_status_idx', false]])
    expect(d.indexes[0]?.sizeBytes).toBeGreaterThan(0)
    expect(d.constraints).toEqual([{ name: 'Orders_pkey', type: 'primary key', definition: 'PRIMARY KEY (tenant, id)' }])
    expect(d.referencedBy).toEqual([expect.objectContaining({ table: 'vd_test.lines', definition: expect.stringContaining('REFERENCES vd_test."Orders"(tenant, id)') })])
    expect(d.stats.find((s) => s.label === 'Total size')?.value).toMatch(/kB|bytes/)
    const fks = await driver.getForeignKeys('vd_test', 'Orders')
    expect(fks.outgoing).toEqual([])
    expect(fks.incoming).toEqual([
      expect.objectContaining({ schema: 'vd_test', table: 'lines', columns: ['tenant', 'order_id'], refSchema: 'vd_test', refTable: 'Orders', refColumns: ['tenant', 'id'] })
    ])
    expect((await driver.getForeignKeys('vd_test', 'lines')).outgoing[0]).toMatchObject({ refTable: 'Orders', columns: ['tenant', 'order_id'] })
    const view = await driver.getTableDetails('vd_test', 'order_view')
    expect(view.ddl).toMatch(/^CREATE VIEW "vd_test"."order_view" AS\n/)
  })

  it('getSchemaSnapshot returns schemas, search_path and every table with ordered columns in one call', async () => {
    const snap = await driver.getSchemaSnapshot()
    expect(snap.schemas).toEqual(expect.arrayContaining(['public', 'vd_test']))
    expect(snap.searchPath[0]).toBe('public')
    const orders = snap.tables.find((t) => t.schema === 'vd_test' && t.name === 'Orders')
    expect(orders?.kind).toBe('table')
    expect(orders?.columns.slice(0, 3)).toEqual([
      ['tenant', 'text'],
      ['id', 'integer'],
      ['status', 'text']
    ])
    expect(snap.tables.find((t) => t.name === 'order_view')?.kind).toBe('view')
    expect(snap.truncated).toBe(false)
  })

  it('cancelQuery stops a running editor query fast; statement timeout fires', async () => {
    const started = Date.now()
    const running = driver.executeQuery('SELECT pg_sleep(30)')
    await new Promise((r) => setTimeout(r, 300))
    expect(await driver.cancelQuery()).toBe(true)
    await expect(running).rejects.toMatchObject({ appError: { message: 'Query cancelled.' } })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(await driver.cancelQuery()).toBe(false) // nothing running now

    driver.setStatementTimeout(200)
    await expect(driver.executeQuery('SELECT pg_sleep(5)')).rejects.toMatchObject({ appError: { message: expect.stringContaining('statement timeout') } })
    driver.setStatementTimeout(0)
    expect((await driver.executeQuery('SHOW statement_timeout')).rows[0]?.[0]).toBe('0')
  })

  it('countRows: planner estimate and exact count with filter', async () => {
    await driver.executeQuery('ANALYZE vd_test."Orders"')
    const est = await driver.countRows('vd_test', 'Orders', { exact: false })
    expect(est.exact).toBe(false)
    expect(est.count).not.toBeNull()
    expect(await driver.countRows('vd_test', 'Orders', { exact: true, where: 'id = 2' })).toEqual({ count: 1, exact: true })
    // A smuggled second statement must be rejected (extended protocol), and nothing deleted.
    await expect(driver.countRows('vd_test', 'Orders', { exact: true, where: 'true); delete from vd_test."Orders"; select (1' })).rejects.toMatchObject({
      appError: { code: 'DB_QUERY_FAILED' }
    })
    expect((await driver.countRows('vd_test', 'Orders', { exact: true })).count).toBe(2)
  })

  it('multi-statement runs return every result set', async () => {
    const r = await driver.executeQuery('SELECT 1 AS a; SELECT 2 AS b, 3 AS c')
    expect(r.statements?.map((s) => s.fields.map((f) => f.name))).toEqual([['a'], ['b', 'c']])
    expect(r.fields.map((f) => f.name)).toEqual(['b', 'c'])
    expect((await driver.executeQuery('SELECT 1')).statements).toBeUndefined()
  })

  it('listSchemaObjects + definitions for functions, sequences, enums and domains', async () => {
    const objs = await driver.listSchemaObjects('vd_test')
    const fn = objs.functions.find((f) => f.name === 'add_one')
    expect(fn).toMatchObject({ signature: 'x integer', returns: 'integer', kind: 'function' })
    expect(await driver.getObjectDefinition('function', fn!.id)).toContain('CREATE OR REPLACE FUNCTION vd_test.add_one(x integer)')
    const seq = objs.sequences.find((q) => q.name === 'ticket_seq')!
    expect(await driver.getObjectDefinition('sequence', seq.id)).toContain('START 100 INCREMENT 5')
    const mood = objs.types.find((t) => t.name === 'mood')!
    expect(mood.kind).toBe('enum')
    expect(await driver.getObjectDefinition('type', mood.id)).toBe(`CREATE TYPE "vd_test"."mood" AS ENUM ('sad', 'ok', 'happy');`)
    const dom = objs.types.find((t) => t.name === 'positive')!
    expect(await driver.getObjectDefinition('type', dom.id)).toBe('CREATE DOMAIN "vd_test"."positive" AS integer\n  CHECK (VALUE > 0);')
    const snap = await driver.getSchemaSnapshot()
    expect(snap.tables.find((t) => t.name === 'Orders')).toHaveProperty('rowEstimate')
  })

  it('ping measures a round trip; the console client recovers after its backend is killed', async () => {
    expect(await driver.ping()).toBeGreaterThanOrEqual(0)
    const pid = (await driver.executeQuery('SELECT pg_backend_pid()')).rows[0]?.[0]
    const killer = setup()
    await killer.driver.connect(killer.config)
    await killer.driver.executeQuery('SELECT pg_terminate_backend($1)', [pid as number])
    await killer.driver.disconnect()
    await new Promise((r) => setTimeout(r, 200))
    // The dead console client is dropped (error event or failed query), and the next run gets a fresh one.
    await driver.executeQuery('SELECT 1').catch(() => undefined)
    expect((await driver.executeQuery('SELECT 2')).rows[0]?.[0]).toBe(2)
  })

  it('explain returns a JSON plan; ANALYZE of a write is rolled back; multi-statement rejected', async () => {
    const plain = await driver.explain('SELECT * FROM vd_test."Orders" WHERE id = 1', { analyze: false })
    expect(plain.analyzed).toBe(false)
    expect((plain.plan as Array<{ Plan: { 'Node Type': string } }>)[0]?.Plan['Node Type']).toBeTruthy()
    const before = (await driver.executeQuery('SELECT count(*)::int FROM vd_test."Orders"')).rows[0]?.[0]
    const analyzed = await driver.explain('DELETE FROM vd_test."Orders"', { analyze: true })
    expect((analyzed.plan as Array<{ Plan: Record<string, unknown> }>)[0]?.Plan['Actual Total Time']).toBeDefined()
    expect((await driver.executeQuery('SELECT count(*)::int FROM vd_test."Orders"')).rows[0]?.[0]).toBe(before) // rolled back
    await expect(driver.explain('SELECT 1; DELETE FROM vd_test."Orders"', { analyze: false })).rejects.toMatchObject({ appError: { code: 'DB_QUERY_FAILED' } })
  })

  it('keeps session state on the console client across runs', async () => {
    await driver.executeQuery('SET search_path = vd_test')
    const r = await driver.executeQuery('SELECT count(*)::int FROM "Orders"')
    expect(r.rows[0]?.[0]).toBe(2)
    await driver.executeQuery('SET search_path = public')
  })

  it('enforces read-only on the server and blocks escape hatches', async () => {
    await driver.setReadOnly(true)
    await expect(driver.executeQuery(`UPDATE vd_test."Orders" SET status = 'x'`)).rejects.toMatchObject({ appError: { code: 'DB_READ_ONLY' } })
    await expect(driver.executeQuery('SET default_transaction_read_only = off')).rejects.toMatchObject({ appError: { code: 'DB_READ_ONLY' } })
    await expect(driver.executeQuery('BEGIN READ WRITE')).rejects.toMatchObject({ appError: { code: 'DB_READ_ONLY' } })
    await expect(
      driver.commitChanges({ schema: 'vd_test', table: 'Orders', changes: [{ kind: 'delete', key: { tenant: 'a', id: 1 } }] })
    ).rejects.toMatchObject({ appError: { code: 'DB_READ_ONLY' } })
    // Pool clients created before the toggle obey it too.
    const ro = await Promise.all([1, 2, 3].map(() => driver.listSchemas()))
    expect(ro).toHaveLength(3)
    const setting = await driver.executeQuery('SHOW default_transaction_read_only')
    expect(setting.rows[0]?.[0]).toBe('on')
    await driver.setReadOnly(false)
  })

  it('commits a changeset atomically', async () => {
    const res = await driver.commitChanges({
      schema: 'vd_test',
      table: 'Orders',
      changes: [
        { kind: 'update', key: { tenant: 'a', id: 1 }, values: { status: 'paid', amount: '10.50' } },
        { kind: 'insert', values: { tenant: 'b', id: 3, at: '2026-01-01T00:00:00Z' } },
        { kind: 'delete', key: { tenant: 'a', id: 2 } }
      ]
    })
    expect(res).toEqual({ statementsExecuted: 3, rowsAffected: 3 })
    const r = await driver.executeQuery(`SELECT tenant, id, status, amount FROM vd_test."Orders" ORDER BY tenant, id`)
    expect(r.rows).toEqual([
      ['a', 1, 'paid', '10.50'],
      ['b', 3, 'new', null]
    ])
  })

  it('rolls back everything when a keyed statement matches no row', async () => {
    await expect(
      driver.commitChanges({
        schema: 'vd_test',
        table: 'Orders',
        changes: [
          { kind: 'update', key: { tenant: 'a', id: 1 }, values: { status: 'should-roll-back' } },
          { kind: 'delete', key: { tenant: 'zzz', id: 999 } }
        ]
      })
    ).rejects.toMatchObject({ appError: { message: expect.stringContaining('rolled back') } })
    const r = await driver.executeQuery(`SELECT status FROM vd_test."Orders" WHERE tenant = 'a' AND id = 1`)
    expect(r.rows[0]?.[0]).toBe('paid')
  })
})
