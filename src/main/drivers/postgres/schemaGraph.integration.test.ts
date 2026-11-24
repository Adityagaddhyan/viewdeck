/**
 * getSchemaGraph against a real server (see PostgresDriver.integration.test.ts for the env
 * vars; skipped without them). Covers cross-schema FKs in both directions, composite and
 * self-referencing FKs, ON DELETE actions, PK / unique keys, external stubs and views.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DriverConnectionConfig } from '@shared/types/driver'
import { PostgresDriver } from './PostgresDriver'

const PORT = Number(process.env['VIEWDECK_PG_TEST_PORT'] ?? 0)
const PASSWORD = process.env['VIEWDECK_PG_TEST_PASSWORD'] ?? ''
const CA_PATH = process.env['VIEWDECK_PG_TEST_CA'] ?? ''
const enabled = PORT > 0 && PASSWORD !== '' && CA_PATH !== ''

describe.skipIf(!enabled)('getSchemaGraph (integration)', () => {
  const driver = new PostgresDriver({
    resolvePassword: async () => PASSWORD,
    iamPasswordProvider: () => async () => PASSWORD,
    rdsCaBundle: () => readFileSync(CA_PATH, 'utf8')
  })
  const config: DriverConnectionConfig = {
    engine: 'postgres',
    host: '127.0.0.1',
    port: PORT,
    database: 'postgres',
    auth: { kind: 'password', user: 'postgres', secretRef: 'x' },
    tls: { mode: 'verify-full', servername: 'db.viewdeck.test', useRdsCaBundle: true },
    readOnly: false,
    statementTimeoutMs: 0
  }

  beforeAll(async () => {
    await driver.connect(config)
    await driver.executeQuery(`
      DROP SCHEMA IF EXISTS vd_graph CASCADE; DROP SCHEMA IF EXISTS vd_graph_ext CASCADE;
      CREATE SCHEMA vd_graph; CREATE SCHEMA vd_graph_ext;
      CREATE TABLE vd_graph_ext.tenants (id int PRIMARY KEY, name text);
      CREATE TABLE vd_graph.customers (id int8 PRIMARY KEY, tenant_id int NOT NULL REFERENCES vd_graph_ext.tenants(id), email text UNIQUE);
      COMMENT ON TABLE vd_graph.customers IS 'People who buy';
      CREATE TABLE vd_graph.profiles (customer_id int8 PRIMARY KEY REFERENCES vd_graph.customers(id) ON DELETE CASCADE, bio text);
      CREATE TABLE vd_graph.orders (tenant int NOT NULL, id int NOT NULL, customer_id int8 REFERENCES vd_graph.customers(id) ON DELETE SET NULL,
        parent_id int, PRIMARY KEY (tenant, id), FOREIGN KEY (tenant, parent_id) REFERENCES vd_graph.orders (tenant, id));
      CREATE TABLE vd_graph.order_lines (id serial PRIMARY KEY, tenant int NOT NULL, order_id int NOT NULL,
        FOREIGN KEY (tenant, order_id) REFERENCES vd_graph.orders (tenant, id) ON DELETE CASCADE);
      CREATE TABLE vd_graph.notes (id int PRIMARY KEY, order_id int);
      CREATE VIEW vd_graph.big_orders AS SELECT * FROM vd_graph.orders;
      CREATE TABLE vd_graph_ext.audit (id int PRIMARY KEY, customer_id int8 REFERENCES vd_graph.customers(id));
      ANALYZE vd_graph.customers;`)
  })
  afterAll(async () => {
    await driver.executeQuery('DROP SCHEMA IF EXISTS vd_graph CASCADE; DROP SCHEMA IF EXISTS vd_graph_ext CASCADE')
    await driver.disconnect()
  })

  it('returns tables, keys and foreign keys in both directions, with external stubs', async () => {
    const g = await driver.getSchemaGraph('vd_graph')
    const t = (schema: string, name: string) => g.tables.find((x) => x.schema === schema && x.name === name)

    expect(g.tables.filter((x) => !x.external).map((x) => x.name).sort()).toEqual(['big_orders', 'customers', 'notes', 'order_lines', 'orders', 'profiles'])
    expect(t('vd_graph', 'big_orders')?.kind).toBe('view')
    expect(t('vd_graph', 'customers')).toMatchObject({ primaryKey: ['id'], uniqueKeys: [['email']], comment: 'People who buy', external: false })
    expect(t('vd_graph', 'orders')?.primaryKey).toEqual(['tenant', 'id'])
    expect(t('vd_graph', 'customers')?.columns.find((c) => c.name === 'tenant_id')).toMatchObject({ dataType: 'integer', nullable: false })

    // Cross-schema both ways: customers → ext.tenants and ext.audit → customers; stubs keep only key columns.
    expect(t('vd_graph_ext', 'tenants')).toMatchObject({ external: true, primaryKey: ['id'] })
    expect(t('vd_graph_ext', 'tenants')?.columns.map((c) => c.name)).toEqual(['id'])
    expect(t('vd_graph_ext', 'audit')?.columns.map((c) => c.name)).toEqual(['id', 'customer_id'])

    const fk = (from: string, to: string) => g.foreignKeys.filter((f) => f.fromTable === from && f.toTable === to)
    expect(fk('profiles', 'customers')[0]).toMatchObject({ fromColumns: ['customer_id'], toColumns: ['id'], onDelete: 'CASCADE' })
    expect(fk('orders', 'customers')[0]?.onDelete).toBe('SET NULL')
    expect(fk('order_lines', 'orders')[0]).toMatchObject({ fromColumns: ['tenant', 'order_id'], toColumns: ['tenant', 'id'], onDelete: 'CASCADE' })
    expect(fk('orders', 'orders')[0]).toMatchObject({ fromColumns: ['tenant', 'parent_id'], toColumns: ['tenant', 'id'] })
    expect(fk('customers', 'tenants')[0]?.toSchema).toBe('vd_graph_ext')
    expect(fk('audit', 'customers')[0]?.fromSchema).toBe('vd_graph_ext')
    expect(g.foreignKeys.some((f) => f.fromTable === 'notes')).toBe(false) // no FK: left to inference
  })
})
