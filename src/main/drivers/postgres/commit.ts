/**
 * Runs prepared changeset statements atomically on one client (ADR-003).
 *
 * BEGIN → each statement → COMMIT. Any error, or a statement whose affected row
 * count differs from `expectRows` (e.g. the row was changed or deleted by
 * someone else), triggers ROLLBACK, and nothing is written.
 */
import type pg from 'pg'
import type { CommitResult, PreparedStatement } from '@shared/types/driver'
import { AppErrorException } from '../../ipc/toAppError'

export async function runInTransaction(client: pg.PoolClient, statements: PreparedStatement[]): Promise<CommitResult> {
  let rowsAffected = 0
  await client.query('BEGIN')
  try {
    for (const [i, stmt] of statements.entries()) {
      const res = await client.query(stmt.sql, stmt.params)
      const affected = res.rowCount ?? 0
      if (stmt.expectRows !== undefined && affected !== stmt.expectRows) {
        throw new AppErrorException({
          code: 'DB_QUERY_FAILED',
          message: `Statement ${i + 1} affected ${affected} rows (expected ${stmt.expectRows}). All changes were rolled back.`,
          hint: 'The row may have been changed or deleted by someone else. Refresh and try again.',
          detail: stmt.sql
        })
      }
      rowsAffected += affected
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  }
  return { statementsExecuted: statements.length, rowsAffected }
}
