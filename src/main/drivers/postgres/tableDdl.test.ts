import { describe, expect, it } from 'vitest'
import { buildTableDdl, formatBytes, type DdlInput } from './tableDdl'

const base: DdlInput = {
  schema: 'billing',
  table: 'invoice_periods',
  relkind: 'r',
  columns: [
    { name: 'id', type: 'bpchar', notNull: true, defaultExpr: null, identity: '', generated: '', comment: null },
    { name: 'seq', type: 'bigint', notNull: true, defaultExpr: null, identity: 'a', generated: '', comment: null },
    { name: 'status', type: 'text', notNull: false, defaultExpr: "'OPEN'::text", identity: '', generated: '', comment: "customer's period state" },
    { name: 'total', type: 'numeric', notNull: false, defaultExpr: 'a + b', identity: '', generated: 's', comment: null }
  ],
  constraints: [{ name: 'invoice_periods_pkey', def: 'PRIMARY KEY (id)' }],
  standaloneIndexes: ['CREATE INDEX ap_status_idx ON billing.invoice_periods USING btree (status)'],
  triggers: [],
  comment: null,
  viewDef: null,
  partitionKey: null,
  partitionOf: null
}

describe('buildTableDdl', () => {
  it('renders columns (identity, default, generated, NOT NULL), constraints, indexes, comments', () => {
    expect(buildTableDdl(base)).toBe(
      [
        'CREATE TABLE "billing"."invoice_periods" (',
        '  "id" bpchar NOT NULL,',
        '  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,',
        `  "status" text DEFAULT 'OPEN'::text,`,
        '  "total" numeric GENERATED ALWAYS AS (a + b) STORED,',
        '  CONSTRAINT "invoice_periods_pkey" PRIMARY KEY (id)',
        ');',
        '',
        'CREATE INDEX ap_status_idx ON billing.invoice_periods USING btree (status);',
        '',
        `COMMENT ON COLUMN "billing"."invoice_periods"."status" IS 'customer''s period state';`
      ].join('\n')
    )
  })

  it('views and partitions', () => {
    expect(buildTableDdl({ ...base, relkind: 'v', viewDef: ' SELECT 1;' , standaloneIndexes: [] })).toBe('CREATE VIEW "billing"."invoice_periods" AS\nSELECT 1;\n\nCOMMENT ON COLUMN "billing"."invoice_periods"."status" IS \'customer\'\'s period state\';')
    expect(buildTableDdl({ ...base, partitionKey: 'RANGE (id)', standaloneIndexes: [], columns: [] , constraints: [] })).toContain(')\nPARTITION BY RANGE (id);')
    expect(
      buildTableDdl({ ...base, partitionOf: { parent: 'billing.ap', bound: "FOR VALUES FROM ('a') TO ('m')" }, standaloneIndexes: [], columns: [] })
    ).toBe(`CREATE TABLE "billing"."invoice_periods" PARTITION OF billing.ap\n  FOR VALUES FROM ('a') TO ('m');`)
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1536, '1.5 kB'],
    [52428800, '50 MB'],
    [null, '–']
  ] as const)('%s → %s', (n, out) => {
    expect(formatBytes(n)).toBe(out)
  })
})
