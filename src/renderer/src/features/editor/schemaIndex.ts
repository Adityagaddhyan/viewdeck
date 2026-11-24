/**
 * In-memory index over a SchemaSnapshot for synchronous (instant) autocomplete
 * lookups. Building it is O(columns) once per snapshot. Every lookup is a Map hit.
 *
 * Name resolution follows Postgres: unqualified names fold to lower case unless
 * quoted, and resolve through `searchPath` in order. The lookups here are
 * case-insensitive as a fallback, because autocomplete should forgive.
 */
import type { SchemaSnapshot, TableInfo } from '@shared/types/driver'

export interface IndexedTable {
  schema: string
  name: string
  kind: TableInfo['kind']
  columns: Array<{ name: string; dataType: string; ordinal: number }>
  /** Planner row estimate from the snapshot (null = never analyzed). */
  rowEstimate: number | null
}

export class SchemaIndex {
  readonly schemas: string[]
  readonly searchPath: string[]
  private readonly bySchema = new Map<string, IndexedTable[]>()
  private readonly byQualified = new Map<string, IndexedTable>()
  private readonly byName = new Map<string, IndexedTable[]>()

  constructor(readonly snapshot: SchemaSnapshot) {
    this.schemas = snapshot.schemas
    this.searchPath = snapshot.searchPath
    for (const t of snapshot.tables) {
      const it: IndexedTable = {
        schema: t.schema,
        name: t.name,
        kind: t.kind,
        columns: t.columns.map(([name, dataType], i) => ({ name, dataType, ordinal: i + 1 })),
        rowEstimate: t.rowEstimate ?? null
      }
      const list = this.bySchema.get(t.schema) ?? []
      list.push(it)
      this.bySchema.set(t.schema, list)
      this.byQualified.set(`${t.schema}\u0000${t.name}`, it)
      const lower = t.name.toLowerCase()
      this.byName.set(lower, [...(this.byName.get(lower) ?? []), it])
    }
  }

  tablesIn(schema: string): IndexedTable[] {
    return this.bySchema.get(schema) ?? this.bySchema.get(this.schemaName(schema) ?? '') ?? []
  }

  /** Exact schema name for a possibly case-different input. */
  schemaName(s: string): string | undefined {
    return this.schemas.find((x) => x === s) ?? this.schemas.find((x) => x.toLowerCase() === s.toLowerCase())
  }

  /** Resolves `schema.table` or an unqualified table via search_path, then any schema. */
  resolve(schema: string | null, table: string): IndexedTable | undefined {
    if (schema) {
      const sn = this.schemaName(schema) ?? schema
      return this.byQualified.get(`${sn}\u0000${table}`) ?? this.tablesIn(sn).find((t) => t.name.toLowerCase() === table.toLowerCase())
    }
    const candidates = this.byName.get(table.toLowerCase()) ?? []
    if (candidates.length <= 1) return candidates[0]
    const exact = candidates.filter((t) => t.name === table)
    const pool = exact.length ? exact : candidates
    for (const s of this.searchPath) {
      const hit = pool.find((t) => t.schema === s)
      if (hit) return hit
    }
    return pool[0]
  }

  /** Tables visible without qualification (search_path schemas, in order). */
  visibleTables(): IndexedTable[] {
    const path = this.searchPath.length ? this.searchPath : ['public']
    return path.flatMap((s) => this.tablesIn(s))
  }

  get tableCount(): number {
    return this.snapshot.tables.length
  }
}
