/**
 * Path helpers for the JSON viewer's "Copy path" actions. Pure, unit-tested.
 *   jsonPath(['items', 0, 'sku'])            → $.items[0].sku
 *   pgAccessor('payload', ['items', 0, 'sku']) → "payload"->'items'->0->>'sku'
 * The Postgres form uses ->> for the last step, so it yields text, which is
 * what you want in a WHERE clause.
 */
export type JsonKey = string | number

const SIMPLE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function jsonPath(path: JsonKey[]): string {
  return path.reduce<string>((acc, k) => {
    if (typeof k === 'number') return `${acc}[${k}]`
    return SIMPLE.test(k) ? `${acc}.${k}` : `${acc}[${JSON.stringify(k)}]`
  }, '$')
}

export function pgAccessor(column: string, path: JsonKey[]): string {
  const col = `"${column.replace(/"/g, '""')}"`
  if (path.length === 0) return col
  return path.reduce<string>((acc, k, i) => {
    const op = i === path.length - 1 ? '->>' : '->'
    const key = typeof k === 'number' ? String(k) : `'${k.replace(/'/g, "''")}'`
    return `${acc}${op}${key}`
  }, col)
}

/** Every container path down to `depth`, for "expand to level N". */
export function containerPaths(value: unknown, depth: number, base: JsonKey[] = []): string[] {
  if (depth < 0 || value === null || typeof value !== 'object') return []
  const own = [JSON.stringify(base)]
  const entries: Array<[JsonKey, unknown]> = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value)
  return own.concat(...entries.map(([k, v]) => containerPaths(v, depth - 1, [...base, k])))
}
