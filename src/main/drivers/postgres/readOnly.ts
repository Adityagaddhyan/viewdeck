/**
 * Server-enforced read-only mode for pooled Postgres clients (ADR-003).
 *
 * `default_transaction_read_only` is per connection, and a pool holds many, so
 * we cannot just run SET once. ReadOnlyTracker records each client's last
 * applied state and syncs it at every checkout:
 *   - locked:   always re-assert ON. A user `BEGIN … SET … ROLLBACK` can undo
 *               an earlier SET, so a cached "already on" is not trusted.
 *   - unlocked: send OFF only if the client is not already known to be off.
 */
import type pg from 'pg'

/**
 * SQL that would undo the server-side lock: SET/RESET of the read-only GUCs,
 * set_config(), `BEGIN/START TRANSACTION … READ WRITE`, or SET SESSION
 * CHARACTERISTICS. Plain `SHOW` / current_setting() reads are allowed.
 */
export const READ_WRITE_ESCAPE =
  /\b(set|reset)\b[^;]*\b(default_)?transaction_read_only\b|\bset_config\s*\(\s*'(default_)?transaction_read_only|\bread\s+write\b|\bsession\s+characteristics\b/i

export class ReadOnlyTracker {
  /** Desired state for every client of the session. Locked by default (safe). */
  enabled = true
  private readonly applied = new WeakMap<pg.PoolClient, boolean>()

  /**
   * Brings `client` in line with `enabled`. If the SET fails (e.g. inside an
   * aborted user transaction, SQLSTATE 25P02) but the client is already known
   * to be in the desired state, the error is swallowed so the user can still
   * run ROLLBACK. Otherwise it propagates and the query is not run.
   */
  async sync(client: pg.PoolClient): Promise<void> {
    const known = this.applied.get(client)
    if (!this.enabled && known === false) return
    try {
      await client.query(`SET default_transaction_read_only = ${this.enabled ? 'on' : 'off'}`)
      this.applied.set(client, this.enabled)
    } catch (err) {
      if (known !== this.enabled) throw err
    }
  }
}
