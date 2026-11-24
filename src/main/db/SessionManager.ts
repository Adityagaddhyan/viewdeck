/**
 * Owns live database sessions: one DatabaseDriver (+ optional SSM tunnel) per
 * session. This is the only code that pairs tunnels with drivers, so it is
 * also where their lifecycles are kept in lock-step:
 *   - connect failure → close the tunnel that was opened for it
 *   - disconnect      → driver first, then tunnel
 *   - tunnel dies     → driver is disconnected, `session:status` is pushed
 */
import { randomUUID } from 'node:crypto'
import type { SavedConnection, SessionInfo } from '@shared/types/connection'
import type { DatabaseDriver, DatabaseEngine } from '@shared/types/driver'
import type { OpenTunnelRequest, TunnelInfo } from '@shared/types/aws'
import { AppErrorException } from '../ipc/toAppError'
import { resolveConnection } from './resolveConnection'
import type { AppSettings } from '@shared/settings'

export interface SessionManagerDeps {
  createDriver(engine: DatabaseEngine): DatabaseDriver
  openTunnel(req: OpenTunnelRequest): Promise<TunnelInfo>
  closeTunnel(id: string): Promise<void>
  /** Pushed when a session ends without the user asking (e.g. tunnel died). */
  onSessionLost?(sessionId: string, reason: string): void
  /** Current app settings (per-tier read-only / timeout defaults). */
  getSettings?(): AppSettings
  now?: () => Date
}

interface Session {
  info: SessionInfo
  driver: DatabaseDriver
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: SessionManagerDeps) {}

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  /** Looks up a session's driver. Throws NOT_FOUND for stale ids from the renderer. */
  driver(sessionId: string): DatabaseDriver {
    return this.require(sessionId).driver
  }

  info(sessionId: string): SessionInfo {
    return { ...this.require(sessionId).info }
  }

  async connect(conn: SavedConnection): Promise<SessionInfo> {
    const resolved = await resolveConnection(conn, (req) => this.deps.openTunnel(req), this.deps.getSettings?.())
    const driver = this.deps.createDriver(conn.engine)
    let serverVersion = 'unknown'
    try {
      await driver.connect(resolved.config)
      const v = await driver.executeQuery('SHOW server_version').catch(() => null)
      serverVersion = String(v?.rows[0]?.[0] ?? 'unknown')
    } catch (err) {
      await driver.disconnect().catch(() => {})
      if (resolved.tunnel) await this.deps.closeTunnel(resolved.tunnel.id).catch(() => {})
      throw err
    }
    const info: SessionInfo = {
      id: randomUUID(),
      connectionId: conn.id,
      name: conn.name,
      engine: conn.engine,
      database: conn.database,
      user: resolved.config.auth.user,
      host: resolved.config.tls.servername ?? (conn.route.kind === 'direct' ? conn.route.host : conn.route.rdsHost),
      capabilities: driver.capabilities,
      readOnly: resolved.config.readOnly,
      statementTimeoutMs: resolved.config.statementTimeoutMs,
      environment: resolved.environment,
      serverVersion,
      tunnelId: resolved.tunnel?.id ?? null,
      connectedAt: (this.deps.now?.() ?? new Date()).toISOString()
    }
    this.sessions.set(info.id, { info, driver })
    return { ...info }
  }

  /** One-shot check of an unsaved or saved connection. Opens and closes its own tunnel. */
  async test(conn: SavedConnection): Promise<{ serverVersion: string }> {
    const resolved = await resolveConnection(conn, (req) => this.deps.openTunnel(req), this.deps.getSettings?.())
    try {
      return await this.deps.createDriver(conn.engine).testConnection(resolved.config)
    } finally {
      if (resolved.tunnel) await this.deps.closeTunnel(resolved.tunnel.id).catch(() => {})
    }
  }

  async setReadOnly(sessionId: string, readOnly: boolean): Promise<SessionInfo> {
    const s = this.require(sessionId)
    await s.driver.setReadOnly(readOnly)
    s.info = { ...s.info, readOnly }
    return { ...s.info }
  }

  setStatementTimeout(sessionId: string, ms: number): SessionInfo {
    const s = this.require(sessionId)
    s.driver.setStatementTimeout(ms)
    s.info = { ...s.info, statementTimeoutMs: ms }
    return { ...s.info }
  }

  async disconnect(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.sessions.delete(sessionId)
    await s.driver.disconnect().catch(() => {})
    if (s.info.tunnelId) await this.deps.closeTunnel(s.info.tunnelId).catch(() => {})
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)))
  }

  /** Wire to SsmTunnelManager status events: a failed or closed tunnel ends its session. */
  handleTunnelStatus(tunnel: TunnelInfo): void {
    if (tunnel.state !== 'failed' && tunnel.state !== 'closed') return
    for (const s of this.sessions.values()) {
      if (s.info.tunnelId !== tunnel.id) continue
      this.sessions.delete(s.info.id)
      void s.driver.disconnect().catch(() => {})
      this.deps.onSessionLost?.(s.info.id, tunnel.error ?? 'The VPC tunnel closed.')
    }
  }

  private require(sessionId: string): Session {
    const s = this.sessions.get(sessionId)
    if (!s) throw new AppErrorException({ code: 'NOT_FOUND', message: 'This session is no longer connected.', hint: 'Reconnect.' })
    return s
  }
}
