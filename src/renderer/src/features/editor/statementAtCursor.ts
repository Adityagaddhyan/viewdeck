/**
 * Splits SQL into statements on top-level `;` and finds the one under the
 * cursor (Cmd/Ctrl+Enter with no selection).
 *
 * Postgres-aware lexing, so semicolons inside these don't split:
 *   'strings' (with '' escapes), E'…\'…' escapes, "quoted identifiers",
 *   $$dollar$$ / $tag$quoted$tag$ bodies (functions, DO blocks),
 *   -- line comments and nested /* block comments *\/.
 */
export interface StatementRange {
  start: number
  end: number
  text: string
}

export function splitStatements(sql: string): StatementRange[] {
  const out: StatementRange[] = []
  let start = 0
  let i = 0
  // True once the current segment has something other than whitespace/comments.
  let hasCode = false
  const n = sql.length

  const push = (end: number): void => {
    const raw = sql.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text && hasCode) out.push({ start: start + lead, end: start + lead + text.length, text })
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? n : nl + 1
    } else if (c === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') (depth++, (i += 2))
        else if (sql[i] === '*' && sql[i + 1] === '/') (depth--, (i += 2))
        else i++
      }
    } else if (c === "'") {
      hasCode = true
      const escapes = i > 0 && /[eE]/.test(sql[i - 1] ?? '') && !/\w/.test(sql[i - 2] ?? '')
      i++
      while (i < n) {
        if (escapes && sql[i] === '\\') i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") {
          i++
          break
        } else i++
      }
    } else if (c === '"') {
      hasCode = true
      i++
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2
        else if (sql[i] === '"') {
          i++
          break
        } else i++
      }
    } else if (c === '$') {
      hasCode = true
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      // `$1` parameters are not dollar quotes. A tag must not start with a digit.
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        i = close === -1 ? n : close + tag[0].length
      } else i++
    } else if (c === ';') {
      push(i)
      start = i + 1
      hasCode = false
      i++
    } else {
      if (!/\s/.test(c ?? '')) hasCode = true
      i++
    }
  }
  push(n)
  return out
}

/**
 * The statement containing `offset`. If the cursor sits in whitespace or just
 * after a `;`, the nearest preceding statement wins, which matches what users
 * expect after finishing a line.
 */
export function statementAtCursor(sql: string, offset: number): StatementRange | null {
  const stmts = splitStatements(sql)
  if (stmts.length === 0) return null
  let best: StatementRange | null = null
  for (const s of stmts) {
    if (offset >= s.start && offset <= s.end + 1) return s
    if (s.start <= offset) best = s
  }
  return best ?? stmts[0] ?? null
}
