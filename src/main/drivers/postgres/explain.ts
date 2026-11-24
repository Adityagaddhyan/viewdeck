/**
 * EXPLAIN for the plan visualiser.
 *
 * - Sent as a NAMED statement, so it uses the extended protocol, which rejects
 *   a second statement (`SELECT 1; DELETE …` fails instead of running).
 * - ANALYZE executes the statement, so it always runs inside BEGIN … ROLLBACK:
 *   writes never persist. While the session is read-only the transaction is
 *   read-only too, so a write fails on the server before doing anything.
 *   (Side effects outside the transaction, like nextval(), still happen.)
 */
import type pg from 'pg'
import type { ExplainResult } from '@shared/types/driver'

let counter = 0

/** Runs EXPLAIN (FORMAT JSON[, ANALYZE, BUFFERS]) for one statement on `c`. */
export async function runExplain(c: pg.PoolClient, sql: string, analyze: boolean): Promise<ExplainResult> {
  const opts = analyze ? 'FORMAT JSON, ANALYZE, BUFFERS' : 'FORMAT JSON'
  const q = { name: `vd_explain_${++counter}`, text: `EXPLAIN (${opts}) ${stripTrailingSemicolon(sql)}` }
  const started = performance.now()
  const exec = async (): Promise<ExplainResult> => {
    const res = await c.query<{ 'QUERY PLAN': unknown }>(q)
    return { plan: parsePlan(res.rows[0]?.['QUERY PLAN']), analyzed: analyze, durationMs: Math.round(performance.now() - started) }
  }
  if (!analyze) return exec()
  await c.query('BEGIN')
  try {
    return await exec()
  } finally {
    await c.query('ROLLBACK').catch(() => {})
  }
}

/** `SELECT 1;  ` → `SELECT 1` (EXPLAIN takes one statement without the terminator). */
export function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

/** EXPLAIN (FORMAT JSON) arrives as JSON text, because our type parsers keep json as text. */
function parsePlan(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v
}
