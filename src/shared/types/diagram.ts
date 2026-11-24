/**
 * Schema-diagram DTOs: everything the ER diagram needs about one schema, fetched in
 * one IPC round trip (`db:getSchemaGraph`). Engine-neutral. The renderer turns it into
 * a diagram model (features/diagram/graphModel.ts).
 *
 * Scope: every table in `schema`, plus "external" stubs for tables in other schemas
 * that a foreign key points to or comes from (so cross-schema links are visible).
 */

export type GraphTableKind = 'table' | 'view' | 'materialized_view' | 'partitioned_table' | 'foreign_table'

export type ReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

export interface GraphColumn {
  name: string
  dataType: string
  nullable: boolean
  /** Column comment, if any. */
  comment: string | null
}

export interface GraphTable {
  schema: string
  name: string
  kind: GraphTableKind
  /** True for tables outside the requested schema, included only because a FK links to them. */
  external: boolean
  /** In ordinal order. External stubs carry only their key columns. */
  columns: GraphColumn[]
  /** Primary-key column names (empty when the table has none). */
  primaryKey: string[]
  /** Column sets of UNIQUE constraints and unique indexes (excluding the PK). Used for one-to-one detection. */
  uniqueKeys: string[][]
  /** Planner estimate (pg_class.reltuples), null when never analyzed. */
  rowEstimate: number | null
  /** Total size including indexes and TOAST, in bytes. */
  totalBytes: number | null
  comment: string | null
}

export interface GraphForeignKey {
  /** Constraint name. */
  name: string
  fromSchema: string
  fromTable: string
  /** Referencing columns, in constraint order. */
  fromColumns: string[]
  toSchema: string
  toTable: string
  /** Referenced columns, same order as fromColumns. */
  toColumns: string[]
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
}

export interface SchemaGraph {
  schema: string
  tables: GraphTable[]
  foreignKeys: GraphForeignKey[]
  /** When the graph was read (ISO), for the cache's "updated …" label. */
  fetchedAt: string
}
