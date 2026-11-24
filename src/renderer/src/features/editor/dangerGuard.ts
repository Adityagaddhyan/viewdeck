/**
 * Detects destructive SQL before it runs in an unlocked session (ADR-003
 * defence in depth): UPDATE/DELETE without WHERE, TRUNCATE, DROP, and
 * ALTER … DROP. Pure, unit-tested.
 *
 * String literals, quoted identifiers, dollar-quoted bodies and comments are
 * blanked out first, so `-- where` in a comment or 'where' in a string can't
 * hide a missing WHERE, and DROP inside a function body doesn't false-alarm.
 */
import { splitStatements } from './statementAtCursor'

export interface Danger {
  statement: string
  reason: string
}

/** Replaces the contents of literals and comments with spaces (offsets preserved). */
export function blankLiterals(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/'(?:[^']|'')*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`)
    .replace(/"(?:[^"]|"")*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`)
}

const RULES: Array<[RegExp, (s: string) => boolean, string]> = [
  [/^\s*(with\b[\s\S]*?\)\s*)?update\b/i, (s) => !/\bwhere\b/i.test(s), 'UPDATE without WHERE changes every row'],
  [/^\s*(with\b[\s\S]*?\)\s*)?delete\s+from\b/i, (s) => !/\bwhere\b/i.test(s), 'DELETE without WHERE removes every row'],
  [/^\s*truncate\b/i, () => true, 'TRUNCATE removes every row'],
  [/^\s*drop\s+(table|schema|database|view|materialized\s+view|index|sequence|type|function|extension)\b/i, () => true, 'DROP permanently removes an object'],
  [/^\s*alter\s+table\b[\s\S]*\bdrop\s+(column|constraint)\b/i, () => true, 'ALTER TABLE … DROP removes a column or constraint']
]

export function findDangers(sql: string): Danger[] {
  const out: Danger[] = []
  for (const stmt of splitStatements(sql)) {
    const blank = blankLiterals(stmt.text)
    for (const [match, isDangerous, reason] of RULES) {
      if (match.test(blank) && isDangerous(blank)) {
        out.push({ statement: stmt.text, reason })
        break
      }
    }
  }
  return out
}
