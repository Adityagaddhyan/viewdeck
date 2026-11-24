/**
 * Start screen: saved connections (connect, edit, duplicate, confirmed delete,
 * copy host), plus entry points to the AWS wizard and the manual form.
 */
import { useState } from 'react'
import { Cloud, Copy, Database, Network, Pencil, Server, Trash2 } from 'lucide-react'
import type { SavedConnection } from '@shared/types/connection'
import type { AppError } from '@shared/types/result'
import { ENV_COLORS } from '@shared/environment'
import { Button } from '@renderer/components/ui/button'
import { ThemeMenu } from '../settings/ThemeMenu'
import { Badge, Spinner } from '@renderer/components/ui/primitives'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { ConfirmDialog, type ConfirmRequest } from '@renderer/components/ConfirmDialog'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { copyText } from '@renderer/lib/clipboard'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions, setState, useAppState } from '@renderer/lib/store'
import { useAsync } from '@renderer/lib/useAsync'
import { connectTo } from '@renderer/lib/sessions'
import { timeAgo } from '../editor/QueriesPanel'
import { EditConnectionDialog } from './EditConnectionDialog'
import { connectionEnvironment } from './editDraft'
import { ManualConnectionDialog } from './ManualConnectionDialog'

const TONE = { prod: 'red', staging: 'amber', dev: 'green', unknown: 'neutral' } as const

export function ConnectionsHome() {
  const notice = useAppState((s) => s.notice)
  const conns = useAsync(() => call('connections:list'), [])
  const [manualOpen, setManualOpen] = useState(false)
  const [editing, setEditing] = useState<SavedConnection | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<{ err: AppError; conn: SavedConnection } | null>(null)

  async function connect(c: SavedConnection): Promise<void> {
    setConnecting(c.id)
    setError(null)
    try {
      await connectTo(c.id)
    } catch (err) {
      setError({ err: asAppError(err), conn: c })
      setConnecting(null)
    }
  }

  const askDelete = (c: SavedConnection): void =>
    setConfirm({
      title: `Delete “${c.name}”?`,
      body: (
        <>
          This removes the saved connection{c.auth.kind === 'password' ? ' and its stored password' : ''}. The database itself is not affected.
          This can't be undone.
        </>
      ),
      confirmLabel: 'Delete connection',
      destructive: true,
      onConfirm: async () => {
        await call('connections:delete', { id: c.id })
        actions.showToast(`Deleted “${c.name}”`)
        await conns.reload()
      }
    })

  const duplicate = async (c: SavedConnection): Promise<void> => {
    const copy = await call('connections:duplicate', { id: c.id })
    actions.showToast(`Duplicated as “${copy.name}”`)
    await conns.reload()
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-3">
        <Database className="size-5 text-muted-foreground" />
        <h1 className="text-base font-semibold">Connections</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setManualOpen(true)}>
            <Server /> Manual
          </Button>
          <Button onClick={() => setState({ screen: { name: 'aws-wizard' }, notice: null })}>
            <Cloud /> New AWS connection
          </Button>
          <ThemeMenu />
        </div>
      </div>

      {notice && <ErrorBanner error={{ code: 'DB_CONNECTION_FAILED', message: notice }} />}
      {error && <ErrorBanner error={error.err} onRetry={() => void connect(error.conn)} />}
      {conns.error && <ErrorBanner error={conns.error} />}

      <div className="rounded-lg border">
        {conns.loading && (
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <Spinner /> Loading…
          </div>
        )}
        {conns.data?.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">
            No saved connections. Use <b>New AWS connection</b> to discover RDS databases from your AWS profiles.
          </div>
        )}
        {conns.data?.map((c) => {
          const env = connectionEnvironment(c)
          return (
            <ContextMenu key={c.id}>
              <ContextMenuTrigger asChild>
                <div className="group flex items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-accent/40 data-[state=open]:bg-accent/40">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: ENV_COLORS[env] }} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => void connect(c)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone={TONE[env]}>{env}</Badge>
                      {c.route.kind === 'ssm-tunnel' && (
                        <Badge tone="blue">
                          <Network className="mr-0.5 size-2.5" /> SSM
                        </Badge>
                      )}
                      {c.auth.kind === 'rds-iam' && <Badge tone="green">IAM</Badge>}
                      {c.lastUsedAt && <span className="text-[10px] text-muted-foreground">used {timeAgo(c.lastUsedAt)}</span>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {c.auth.user}@{c.route.kind === 'direct' ? `${c.route.host}:${c.route.port}` : c.route.rdsHost}/{c.database}
                      {c.aws ? ` · ${c.aws.profile} · ${c.aws.region}` : ''}
                    </div>
                  </button>
                  {connecting === c.id ? (
                    <Spinner />
                  ) : (
                    <div className="flex opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(c)} title="Edit">
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => askDelete(c)} title="Delete">
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => void connect(c)}>Connect</ContextMenuItem>
                <ContextMenuItem onSelect={() => setEditing(c)}>
                  <Pencil /> Edit…
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void duplicate(c)}>
                  <Copy /> Duplicate
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void copyText(c.route.kind === 'direct' ? c.route.host : c.route.rdsHost, 'Copied host')}>Copy host</ContextMenuItem>
                <ContextMenuItem onSelect={() => void copyText(c.name, 'Copied name')}>Copy name</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem destructive onSelect={() => askDelete(c)}>
                  <Trash2 /> Delete…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <ManualConnectionDialog open={manualOpen} onOpenChange={setManualOpen} onSaved={() => void conns.reload()} />
      <EditConnectionDialog connection={editing} onClose={() => setEditing(null)} onSaved={() => void conns.reload()} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
