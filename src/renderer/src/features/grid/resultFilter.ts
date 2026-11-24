/**
 * Client-side WHERE filter for rows that are already loaded (query results).
 * The user types a SQL condition; it is parsed here and evaluated per row, so
 * nothing is sent to the database (safe on prod, instant as you type).
 *
 * Supported: = != <> < <= > >=, AND / OR / NOT, parentheses, IS [NOT] NULL /
 * TRUE / FALSE, [NOT] LIKE / ILIKE, ~ ~* !~ !~*, [NOT] IN (…), [NOT] BETWEEN,
 * + - * / % ||, ::casts (text, int, numeric, float, bool; others ignored),
 * lower / upper / length / trim / coalesce / abs / round, an optional leading
 * WHERE, "quoted" and case-insensitive column names.
 *
 * Anything it can't parse, or an unknown column, returns `{ ok: false }`:
 * callers then show every row instead of an error. Semantics follow SQL where
 * it matters: NULL compares as unknown (row excluded), numeric text (int8,
 * numeric arrive as strings) compares numerically.
 */
import type { CellValue, QueryField } from '@shared/types/driver'

type V = string | number | boolean | null
type Fn = (row: CellValue[]) => V
interface Node {
  fn: Fn
  /** Whether the node yields a boolean (only those can be the whole filter). */
  bool: boolean
}

export type CompiledFilter = { ok: true; test: (row: CellValue[]) => boolean } | { ok: false }

class Fail extends Error {}
const fail = (): never => {
  throw new Fail()
}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|'((?:[^']|'')*)'|"((?:[^"]|"")+)"|([A-Za-z_][\w$]*)|(::|<>|!=|<=|>=|!~\*|!~|~\*|\|\||[=<>~(),+\-*/%]))/iy

function tokenize(src: string): string[] {
  const out: string[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break
    const m = TOKEN.exec(src)
    if (!m) fail()
    if (m![1] !== undefined) out.push(`#${m![1]}`)
    else if (m![2] !== undefined) out.push(`'${m![2].replace(/''/g, "'")}`)
    else if (m![3] !== undefined) out.push(`"${m![3].replace(/""/g, '"')}`)
    else if (m![4] !== undefined) out.push(`w${m![4]}`)
    else out.push(`o${m![5]}`)
  }
  return out
}

const NUMERIC = /^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i
function asNumber(v: V): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && NUMERIC.test(v)) return Number(v)
  return null
}
function compare(a: V, b: V): number | null {
  if (a === null || b === null) return null
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na - nb
  const sa = typeof a === 'boolean' ? String(a) : String(a)
  const sb = typeof b === 'boolean' ? String(b) : String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
function truth(v: V): boolean | null {
  if (v === null) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'string' && /^(t|true)$/i.test(v)) return true
  if (typeof v === 'string' && /^(f|false)$/i.test(v)) return false
  return null
}
const likeRegex = (pattern: string, flags: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\*]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, `s${flags}`)

const FUNCS: Record<string, (args: V[]) => V> = {
  lower: ([a]) => (a === null || a === undefined ? null : String(a).toLowerCase()),
  upper: ([a]) => (a === null || a === undefined ? null : String(a).toUpperCase()),
  length: ([a]) => (a === null || a === undefined ? null : [...String(a)].length),
  trim: ([a]) => (a === null || a === undefined ? null : String(a).trim()),
  coalesce: (args) => args.find((a) => a !== null) ?? null,
  abs: ([a]) => (asNumber(a ?? null) === null ? null : Math.abs(asNumber(a ?? null)!)),
  round: ([a, d]) => {
    const n = asNumber(a ?? null)
    if (n === null) return null
    const p = 10 ** (asNumber(d ?? 0) ?? 0)
    return Math.round(n * p) / p
  }
}

/** Compiles `where` against `fields`. Empty input → `{ ok: false }` (no filter). */
export function compileFilter(where: string, fields: QueryField[]): CompiledFilter {
  const src = where.trim().replace(/^where\b/i, '').replace(/;\s*$/, '')
  if (!src.trim()) return { ok: false }
  try {
    const toks = tokenize(src)
    let i = 0
    const peek = (): string | undefined => toks[i]
    const isWord = (w: string, t = peek()): boolean => !!t && t[0] === 'w' && t.slice(1).toLowerCase() === w
    const isOp = (o: string, t = peek()): boolean => t === `o${o}`
    const eatWord = (w: string): boolean => (isWord(w) ? (i++, true) : false)
    const eatOp = (o: string): boolean => (isOp(o) ? (i++, true) : false)
    const expectOp = (o: string): void => void (eatOp(o) || fail())

    const column = (name: string, quoted: boolean): Node => {
      let idx = fields.findIndex((f) => f.name === name)
      if (idx < 0 && !quoted) idx = fields.findIndex((f) => f.name.toLowerCase() === name.toLowerCase())
      if (idx < 0) fail()
      const isBool = /^bool/i.test(fields[idx]!.dataType)
      return { fn: (r) => r[idx] ?? null, bool: isBool }
    }

    const primary = (): Node => {
      const t = peek()
      if (!t) return fail()
      if (eatOp('(')) {
        const e = orExpr()
        expectOp(')')
        return e
      }
      if (eatOp('-')) {
        const e = postfix()
        return { fn: (r) => { const n = asNumber(e.fn(r)); return n === null ? null : -n }, bool: false }
      }
      i++
      if (t[0] === '#') { const n = Number(t.slice(1)); return { fn: () => n, bool: false } }
      if (t[0] === "'") { const s = t.slice(1); return { fn: () => s, bool: false } }
      if (t[0] === '"') return column(t.slice(1), true)
      if (t[0] === 'w') {
        const w = t.slice(1).toLowerCase()
        if (w === 'true' || w === 'false') { const b = w === 'true'; return { fn: () => b, bool: true } }
        if (w === 'null') return { fn: () => null, bool: false }
        if (isOp('(') && FUNCS[w]) {
          i++
          const args: Node[] = []
          if (!eatOp(')')) {
            do args.push(orExpr())
            while (eatOp(','))
            expectOp(')')
          }
          const f = FUNCS[w]!
          return { fn: (r) => f(args.map((a) => a.fn(r))), bool: false }
        }
        if (['and', 'or', 'not', 'is', 'in', 'like', 'ilike', 'between'].includes(w)) fail()
        return column(t.slice(1), false)
      }
      return fail()
    }

    const postfix = (): Node => {
      let e = primary()
      while (eatOp('::')) {
        const t = peek()
        if (!t || t[0] !== 'w') fail()
        i++
        const type = t!.slice(1).toLowerCase()
        while (eatOp('(')) { while (peek() && !isOp(')')) i++; expectOp(')') } // varchar(20), numeric(10,2)
        const inner = e
        if (/^(int|integer|bigint|smallint|int[248]|numeric|decimal|float[48]?|real|double)$/.test(type)) e = { fn: (r) => asNumber(inner.fn(r)), bool: false }
        else if (/^(text|varchar|char|bpchar|string)$/.test(type)) e = { fn: (r) => { const v = inner.fn(r); return v === null ? null : String(v) }, bool: false }
        else if (/^bool(ean)?$/.test(type)) e = { fn: (r) => truth(inner.fn(r)), bool: true }
      }
      return e
    }

    const term = (): Node => {
      let e = postfix()
      for (;;) {
        const op = ['*', '/', '%'].find((o) => isOp(o))
        if (!op) return e
        i++
        const l = e, rgt = postfix()
        e = {
          fn: (r) => {
            const a = asNumber(l.fn(r)), b = asNumber(rgt.fn(r))
            if (a === null || b === null) return null
            if (op === '*') return a * b
            if (b === 0) return null
            return op === '/' ? a / b : a % b
          },
          bool: false
        }
      }
    }

    const additive = (): Node => {
      let e = term()
      for (;;) {
        const op = ['+', '-', '||'].find((o) => isOp(o))
        if (!op) return e
        i++
        const l = e, rgt = term()
        e = op === '||'
          ? { fn: (r) => { const a = l.fn(r), b = rgt.fn(r); return a === null || b === null ? null : `${a}${b}` }, bool: false }
          : { fn: (r) => { const a = asNumber(l.fn(r)), b = asNumber(rgt.fn(r)); return a === null || b === null ? null : op === '+' ? a + b : a - b }, bool: false }
      }
    }

    const predicate = (): Node => {
      const l = additive()
      const cmp = ['=', '!=', '<>', '<=', '>=', '<', '>'].find((o) => isOp(o))
      if (cmp) {
        i++
        const rgt = additive()
        return {
          fn: (r) => {
            const c = compare(l.fn(r), rgt.fn(r))
            if (c === null) return null
            return cmp === '=' ? c === 0 : cmp === '<' ? c < 0 : cmp === '>' ? c > 0 : cmp === '<=' ? c <= 0 : cmp === '>=' ? c >= 0 : c !== 0
          },
          bool: true
        }
      }
      const re = ['~', '~*', '!~', '!~*'].find((o) => isOp(o))
      if (re) {
        i++
        const p = additive()
        const cache = new Map<string, RegExp | null>()
        return {
          fn: (r) => {
            const v = l.fn(r), pat = p.fn(r)
            if (v === null || pat === null) return null
            const key = String(pat)
            if (!cache.has(key)) { try { cache.set(key, new RegExp(key, re.includes('*') ? 'i' : '')) } catch { cache.set(key, null) } }
            const rx = cache.get(key)
            if (!rx) return null
            return rx.test(String(v)) !== re.startsWith('!')
          },
          bool: true
        }
      }
      if (eatWord('is')) {
        const neg = eatWord('not')
        const what = eatWord('null') ? 'null' : eatWord('true') ? 'true' : eatWord('false') ? 'false' : fail()
        return {
          fn: (r) => {
            const v = l.fn(r)
            const hit = what === 'null' ? v === null : truth(v) === (what === 'true')
            return hit !== neg
          },
          bool: true
        }
      }
      const neg = eatWord('not')
      if (isWord('like') || isWord('ilike')) {
        const flags = isWord('ilike') ? 'i' : ''
        i++
        const p = additive()
        return {
          fn: (r) => {
            const v = l.fn(r), pat = p.fn(r)
            if (v === null || pat === null) return null
            return likeRegex(String(pat), flags).test(String(v)) !== neg
          },
          bool: true
        }
      }
      if (eatWord('in')) {
        expectOp('(')
        const items: Node[] = []
        do items.push(additive())
        while (eatOp(','))
        expectOp(')')
        return {
          fn: (r) => {
            const v = l.fn(r)
            if (v === null) return null
            let sawNull = false
            for (const it of items) {
              const c = compare(v, it.fn(r))
              if (c === 0) return !neg
              if (c === null) sawNull = true
            }
            return sawNull ? null : neg
          },
          bool: true
        }
      }
      if (eatWord('between')) {
        const lo = additive()
        if (!eatWord('and')) fail()
        const hi = additive()
        return {
          fn: (r) => {
            const v = l.fn(r)
            const a = compare(v, lo.fn(r)), b = compare(v, hi.fn(r))
            if (a === null || b === null) return null
            return (a >= 0 && b <= 0) !== neg
          },
          bool: true
        }
      }
      if (neg) fail()
      return l
    }

    const notExpr = (): Node => {
      if (eatWord('not')) {
        const e = notExpr()
        return { fn: (r) => { const t = truth(e.fn(r)); return t === null ? null : !t }, bool: true }
      }
      return predicate()
    }
    const andExpr = (): Node => {
      let e = notExpr()
      while (eatWord('and')) {
        const l = e, rgt = notExpr()
        e = { fn: (r) => { const a = truth(l.fn(r)); if (a === false) return false; const b = truth(rgt.fn(r)); return b === false ? false : a === null || b === null ? null : true }, bool: true }
      }
      return e
    }
    function orExpr(): Node {
      let e = andExpr()
      while (eatWord('or')) {
        const l = e, rgt = andExpr()
        e = { fn: (r) => { const a = truth(l.fn(r)); if (a === true) return true; const b = truth(rgt.fn(r)); return b === true ? true : a === null || b === null ? null : false }, bool: true }
      }
      return e
    }

    const root = orExpr()
    if (i !== toks.length || !root.bool) return { ok: false }
    return { ok: true, test: (row) => truth(root.fn(row)) === true }
  } catch (err) {
    if (err instanceof Fail || err instanceof SyntaxError) return { ok: false }
    throw err
  }
}
