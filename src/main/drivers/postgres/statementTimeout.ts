/**
 * Keeps `statement_timeout` in sync on every pooled / console connection, the
 * same way ReadOnlyTracker does for read-only: the desired value is applied at
 * checkout only when it differs from what that client last had. A failed SET
 * (e.g. inside an aborted user transaction) is ignored and retried at the next
 * checkout. The timeout is a convenience guard, not a safety lock.
 */
import type pg from 'pg'

export class StatementTimeoutTracker {
  /** Desired timeout in ms; 0 = off. */
  ms = 0
  private readonly applied = new WeakMap<pg.PoolClient, number>()

  /** Marks a fresh client as already having `ms` (it got it via the startup options). */
  assume(client: pg.PoolClient, ms: number): void {
    if (!this.applied.has(client)) this.applied.set(client, ms)
  }

  async sync(client: pg.PoolClient): Promise<void> {
    if (this.applied.get(client) === this.ms) return
    try {
      await client.query(`SET statement_timeout = ${Math.max(0, Math.floor(this.ms))}`)
      this.applied.set(client, this.ms)
    } catch {
      /* retried at next checkout */
    }
  }
}
