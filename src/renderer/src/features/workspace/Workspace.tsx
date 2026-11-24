/**
 * Connected workspace: environment-framed header, schema sidebar, tab strip,
 * and the active tab (query editor or table grid), or two tabs side by side in
 * split view (lib/splitView.ts). Inactive tabs stay mounted (hidden) so editor
 * text, results and staged edits survive tab switches.
 */
import { useState } from 'react'
import { Code2, Columns2, Network, Plus, Power, RefreshCw, Search, SquarePen, Table2, X } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { ENV_COLORS } from '@shared/environment'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/primitives'
import { EnvironmentBar } from '@renderer/components/EnvironmentBar'
import { ConfirmDialog, type ConfirmRequest } from '@renderer/components/ConfirmDialog'
import { hasStagedEdits, leaveSession } from '@renderer/lib/sessions'
import { MOD_LABEL } from '@renderer/lib/hotkeys'
import { actions, getState, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { paneOf } from '@renderer/lib/splitView'
import { CompareRowsDialog } from '../grid/CompareRowsDialog'
import { schemaCache } from '../editor/schemaCache'
import { QueryTab } from '../editor/QueryTab'
import { TableTab } from '../grid/TableTab'
import { DiagramTab } from '../diagram/DiagramTab'
import { ConnectionSwitcher } from './ConnectionSwitcher'
import { ReadOnlyToggle } from './ReadOnlyToggle'
import { ThemeMenu } from '../settings/ThemeMenu'
import { SchemaExplorer } from './SchemaExplorer'
import { StatusBar } from './StatusBar'

export function Workspace() {
  const session = useAppState((s) => s.session)
  const tabs = useAppState((s) => s.tabs)
  const activeTabId = useAppState((s) => s.activeTabId)
  const reconnecting = useAppState((s) => s.reconnecting)
  const split = useAppState((s) => s.split)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  if (!session) return null
  schemaCache.use(session.id, session.connectionId)

  function disconnect(): void {
    if (!hasStagedEdits()) return void leaveSession()
    setConfirm({
      title: 'Discard staged changes?',
      body: 'Some table tabs have staged edits that have not been committed. Disconnecting discards them.',
      confirmLabel: 'Discard and disconnect',
      destructive: true,
      onConfirm: () => leaveSession()
    })
  }

  return (
    <div className="flex h-full flex-col">
      <EnvironmentBar tier={session.environment} />
      <header className="flex h-10 shrink-0 items-center gap-2 border-b pl-20 pr-2 [-webkit-app-region:drag]">
        <ConnectionSwitcher />
        <span className="font-mono text-[11px] text-muted-foreground">{session.database}</span>
        <Badge style={{ color: ENV_COLORS[session.environment] }}>{session.environment}</Badge>
        {session.tunnelId && <Badge tone="blue">SSM tunnel</Badge>}
        <span className="text-[11px] text-muted-foreground">PostgreSQL {session.serverVersion}</span>
        <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
          <Button variant="outline" size="sm" onClick={() => actions.newQueryTab()} title={`New query tab (${MOD_LABEL}T)`}>
            <SquarePen /> New query
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => actions.setPalette(true)} title="Command palette">
            <Search /> Jump to… <kbd className="text-[10px] opacity-70">{MOD_LABEL}K</kbd>
          </Button>
          <ReadOnlyToggle />
          <ThemeMenu />
          <Button variant="ghost" size="sm" onClick={disconnect} title="Disconnect">
            <Power /> Disconnect
          </Button>
        </div>
      </header>

      {reconnecting && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-200" role="status">
          <RefreshCw className="size-3 animate-spin" /> Connection lost ({reconnecting.reason}). Reconnecting, attempt {reconnecting.attempt} of {reconnecting.of}…
          Your tabs and staged edits are kept.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r bg-card/40">
          <SchemaExplorer sessionId={session.id} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b bg-card/40" role="tablist" aria-label="Open tabs">
            {tabs.map((t) => (
              <ContextMenu key={t.id}>
              <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={t.id === activeTabId}
                aria-label={t.title}
                className={cn(
                  'group flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 border-r px-2.5 text-[12px]',
                  t.id === activeTabId ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/40'
                )}
                onClick={() => actions.activateTab(t.id)}
                onAuxClick={(e) => e.button === 1 && actions.closeTab(t.id)}
              >
                {t.kind === 'query' ? <Code2 className="size-3 shrink-0" /> : t.kind === 'diagram' ? <Network className="size-3 shrink-0" /> : <Table2 className="size-3 shrink-0" />}
                <span className="truncate">{t.title}</span>
                {paneOf(split, t.id) && <Columns2 className="size-3 shrink-0 text-sky-400" aria-label={`In split view (${paneOf(split, t.id)})`} />}
                <button
                  className="rounded opacity-0 hover:bg-accent group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    actions.closeTab(t.id)
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => actions.closeTab(t.id)}>Close tab</ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.closeOtherTabs(t.id)} disabled={tabs.length < 2}>
                  Close other tabs
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.closeAllTabs()}>Close all tabs</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => actions.splitWith(t.id)}>
                  {t.id === activeTabId ? 'Split: new query beside this tab' : 'Open beside current tab'}
                </ContextMenuItem>
                {split && <ContextMenuItem onSelect={() => actions.closeSplit()}>Close split view</ContextMenuItem>}
                <ContextMenuSeparator />
                {t.kind === 'query' ? (
                  <ContextMenuItem onSelect={() => duplicateQueryTab(t.id)}>
                    Duplicate query tab
                  </ContextMenuItem>
                ) : t.kind === 'table' ? (
                  <>
                    <ContextMenuItem onSelect={() => actions.openTable(t.schema, t.table, { info: true })}>Show info &amp; DDL</ContextMenuItem>
                    <ContextMenuItem onSelect={() => actions.openDiagram(t.schema, t.table)}>Show in diagram</ContextMenuItem>
                  </>
                ) : null}
                <ContextMenuItem onSelect={() => actions.newQueryTab()} shortcut={`${MOD_LABEL}T`}>
                  New query tab
                </ContextMenuItem>
              </ContextMenuContent>
              </ContextMenu>
            ))}
            <button className="px-2 text-muted-foreground hover:text-foreground" onClick={() => actions.newQueryTab()} title="New query tab">
              <Plus className="size-3.5" />
            </button>
            <button
              className={cn('ml-auto px-2 hover:text-foreground', split ? 'text-sky-400' : 'text-muted-foreground')}
              onClick={() => (split ? actions.closeSplit() : actions.splitWith())}
              title={split ? 'Close split view' : 'Split view: show two tabs side by side'}
              aria-label={split ? 'Close split view' : 'Split view'}
            >
              <Columns2 className="size-3.5" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            {tabs.length === 0 && (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Open a table from the sidebar or create a query tab.
              </div>
            )}
            {tabs.map((t) => {
              const pane = paneOf(split, t.id)
              const visible = pane !== null || t.id === activeTabId
              return (
              <div
                key={t.id}
                data-active={t.id === activeTabId}
                data-pane={pane ?? undefined}
                className={cn(
                  'absolute inset-y-0',
                  pane === 'left' ? 'left-0 w-1/2' : pane === 'right' ? 'left-1/2 right-0 border-l' : 'inset-x-0',
                  !visible && 'invisible',
                  pane && t.id === activeTabId && 'shadow-[inset_0_2px_0_0_rgb(56_189_248)]'
                )}
                onMouseDownCapture={() => pane && t.id !== activeTabId && actions.activateTab(t.id)}
              >
                {t.kind === 'query' ? (
                  <QueryTab tabId={t.id} initialSql={t.sql} active={t.id === activeTabId} />
                ) : t.kind === 'diagram' ? (
                  <DiagramTab schema={t.schema} active={t.id === activeTabId} focusRequest={t.focusRequest} />
                ) : (
                  <TableTab tabId={t.id} schema={t.schema} table={t.table} active={t.id === activeTabId} infoRequest={t.infoRequest} filterRequest={t.filterRequest} />
                )}
              </div>
              )
            })}
          </div>
        </main>
      </div>
      <StatusBar />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <CompareRowsDialog />
    </div>
  )
}

/** Opens a new query tab with the latest text of query tab `id`. */
function duplicateQueryTab(id: string): void {
  const tab = getState().tabs.find((x) => x.id === id)
  actions.newQueryTab(tab?.kind === 'query' ? tab.sql : '')
}
