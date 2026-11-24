/**
 * Top-left connection switcher: the current connection's name opens a menu of
 * saved connections grouped by environment (colour dots, current one checked),
 * plus New AWS connection, Manual connection and Manage connections.
 * Switching connects the new session first, so the current one stays usable if
 * that fails, and asks before discarding staged grid edits.
 */
import { useState } from 'react'
import { Check, ChevronDown, Cloud, Database, Settings2, Server } from 'lucide-react'
import type { SavedConnection } from '@shared/types/connection'
import { ENV_COLORS, type EnvironmentTier } from '@shared/environment'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Spinner } from '@renderer/components/ui/primitives'
import { ConfirmDialog, type ConfirmRequest } from '@renderer/components/ConfirmDialog'
import { asAppError, call } from '@renderer/lib/ipc'
import { connectTo, hasStagedEdits, leaveSession } from '@renderer/lib/sessions'
import { actions, setState, useAppState } from '@renderer/lib/store'
import { connectionEnvironment } from '../connect/editDraft'
import { ManualConnectionDialog } from '../connect/ManualConnectionDialog'

const GROUPS: EnvironmentTier[] = ['prod', 'staging', 'dev', 'unknown']

export function ConnectionSwitcher() {
  const session = useAppState((s) => s.session)
  const [conns, setConns] = useState<SavedConnection[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  if (!session) return null

  /** Runs `fn`, first asking to discard staged edits if there are any. */
  const guarded = (what: string, fn: () => void | Promise<void>): void => {
    if (!hasStagedEdits()) return void fn()
    setConfirm({
      title: 'Discard staged changes?',
      body: `Some table tabs have staged edits that haven't been committed. ${what} will discard them.`,
      confirmLabel: 'Discard and continue',
      destructive: true,
      onConfirm: fn
    })
  }

  const switchTo = (c: SavedConnection): void =>
    guarded(`Switching to “${c.name}”`, async () => {
      setSwitching(c.id)
      try {
        await connectTo(c.id)
        actions.showToast(`Connected to ${c.name}`)
      } catch (e) {
        actions.showToast(`Could not connect to ${c.name}: ${asAppError(e).message}`)
      } finally {
        setSwitching(null)
      }
    })

  const grouped = GROUPS.map((g) => ({ g, items: (conns ?? []).filter((c) => connectionEnvironment(c) === g) })).filter((x) => x.items.length)

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && void call('connections:list').then(setConns).catch(() => setConns([]))}>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent [-webkit-app-region:no-drag]" title="Switch connection">
            {switching ? <Spinner /> : <Database className="size-4 text-muted-foreground" />}
            <span className="truncate font-semibold">{session.name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[70vh] w-80 overflow-auto">
          {!conns && (
            <div className="flex items-center gap-2 p-2 text-muted-foreground">
              <Spinner /> Loading…
            </div>
          )}
          {grouped.map(({ g, items }) => (
            <div key={g}>
              <DropdownMenuLabel>{g}</DropdownMenuLabel>
              {items.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => c.id !== session.connectionId && switchTo(c)}>
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: ENV_COLORS[g] }} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.id === session.connectionId && <Check className="!text-emerald-400" />}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => guarded('Starting a new connection', async () => {
            await leaveSession()
            setState({ screen: { name: 'aws-wizard' } })
          })}>
            <Cloud /> New AWS connection…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => guarded('Starting a new connection', () => setManualOpen(true))}>
            <Server /> Manual connection…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => guarded('Leaving this connection', () => leaveSession())}>
            <Settings2 /> Manage connections…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ManualConnectionDialog open={manualOpen} onOpenChange={setManualOpen} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
