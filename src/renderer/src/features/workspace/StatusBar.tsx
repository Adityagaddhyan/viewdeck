/**
 * Workspace status bar: user@host/db, environment, SSM tunnel state, live
 * latency (db:ping every 15 s on a pool connection), session age, read-only
 * state, statement timeout and server version.
 */
import { useEffect, useState } from 'react'
import { Activity, Clock, Lock, LockOpen, Network, Timer } from 'lucide-react'
import type { TunnelState } from '@shared/types/aws'
import { ENV_COLORS } from '@shared/environment'
import { call, onEvent } from '@renderer/lib/ipc'
import { useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { formatTimeout } from '../editor/TimeoutPicker'

const PING_MS = 15_000

export function formatAge(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function StatusBar() {
  const session = useAppState((s) => s.session)
  const [latency, setLatency] = useState<number | 'offline' | null>(null)
  const [tunnel, setTunnel] = useState<TunnelState | null>(null)
  const [now, setNow] = useState(Date.now())
  const sessionId = session?.id
  const tunnelId = session?.tunnelId

  useEffect(() => {
    if (!sessionId) return
    let stopped = false
    const ping = (): void => {
      void call('db:ping', { sessionId })
        .then((r) => !stopped && setLatency(r.ms))
        .catch(() => !stopped && setLatency('offline'))
    }
    ping()
    const t = setInterval(ping, PING_MS)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [sessionId])

  useEffect(() => {
    setTunnel(tunnelId ? 'ready' : null)
    if (!tunnelId) return
    return onEvent('tunnel:status', (info) => info.id === tunnelId && setTunnel(info.state))
  }, [tunnelId])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!session) return null
  const item = 'flex items-center gap-1 whitespace-nowrap'

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-card/60 px-3 text-[11px] text-muted-foreground" aria-label="Status bar">
      <span className={item}>
        <span className="size-2 rounded-full" style={{ backgroundColor: ENV_COLORS[session.environment] }} />
        <span className="font-mono">
          {session.user}@{session.host}/{session.database}
        </span>
      </span>
      {tunnel && (
        <span className={cn(item, tunnel === 'ready' ? 'text-sky-400' : 'text-amber-400')} title="SSM port-forwarding tunnel">
          <Network className="size-3" /> SSM {tunnel}
        </span>
      )}
      <span className={cn(item, latency === 'offline' && 'text-red-400')} title="Round trip (SELECT 1), refreshed every 15s">
        <Activity className="size-3" />
        {latency === null ? '…' : latency === 'offline' ? 'offline' : `${latency} ms`}
      </span>
      <span className={item} title={`Connected at ${new Date(session.connectedAt).toLocaleTimeString()}`}>
        <Clock className="size-3" /> {formatAge(now - new Date(session.connectedAt).getTime())}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <span className={item}>
          {session.readOnly ? <Lock className="size-3" /> : <LockOpen className="size-3 text-amber-500" />}
          {session.readOnly ? 'read-only' : 'writable'}
        </span>
        <span className={item} title="Statement timeout">
          <Timer className="size-3" /> {formatTimeout(session.statementTimeoutMs)}
        </span>
        <span className={item}>PostgreSQL {session.serverVersion}</span>
      </div>
    </footer>
  )
}
