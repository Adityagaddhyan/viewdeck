import { useEffect } from 'react'
import { EnvironmentBar } from '@renderer/components/EnvironmentBar'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { Toaster } from '@renderer/components/Toaster'
import { useHotkey } from '@renderer/lib/hotkeys'
import { call, onEvent } from '@renderer/lib/ipc'
import { hasStagedEdits, leaveSession } from '@renderer/lib/sessions'
import { recoverSession } from '@renderer/lib/reconnect'
import { startWorkspacePersistence } from '@renderer/lib/workspacePersistence'
import { actions, getState, setState, useAppState } from '@renderer/lib/store'
import { AwsWizard } from '@renderer/features/connect/awsWizard/AwsWizard'
import { ConnectionsHome } from '@renderer/features/connect/ConnectionsHome'
import { Workspace } from '@renderer/features/workspace/Workspace'
import { CommandPalette } from '@renderer/features/palette/CommandPalette'
import { SettingsDialog } from '@renderer/features/settings/SettingsDialog'
import { useApplyTheme } from '@renderer/lib/theme'
import { checkForUpdatesNow } from '@renderer/lib/updates'
import { UpdateBanner } from '@renderer/features/update/UpdateBanner'

/**
 * Top-level screen router (connections home → AWS wizard → workspace) plus
 * app-wide shortcuts: Cmd/Ctrl+K palette, Cmd/Ctrl+T new query tab.
 * Cmd/Ctrl+Enter lives in SqlEditor and Cmd/Ctrl+S in TableTab, scoped to the active tab.
 */
export function App() {
  const screen = useAppState((s) => s.screen)
  const paletteOpen = useAppState((s) => s.paletteOpen)
  useHotkey('mod+k', () => actions.setPalette(!paletteOpen))
  useHotkey('mod+t', () => actions.newQueryTab(), screen.name === 'workspace')
  // Browser-style tab cycling. Literal Ctrl on every platform (Cmd+Tab belongs to macOS).
  useHotkey('ctrl+tab', () => actions.cycleTab(1), screen.name === 'workspace')
  useHotkey('ctrl+shift+tab', () => actions.cycleTab(-1), screen.name === 'workspace')

  // A session can end underneath us (its SSM tunnel died). Return home and say why.
  useEffect(() => startWorkspacePersistence(), [])
  useEffect(() => void call('settings:get').then(actions.setSettings).catch(() => {}), [])
  useApplyTheme()
  useHotkey('mod+,', () => actions.setSettingsOpen(true))
  // Native menu commands (src/main/menu.ts).
  useEffect(
    () =>
      onEvent('menu:command', ({ command }) => {
        const { screen: sc, activeTabId, session } = getState()
        const inWorkspace = sc.name === 'workspace'
        switch (command) {
          case 'palette':
            return actions.setPalette(true)
          case 'settings':
            return actions.setSettingsOpen(true)
          case 'newQueryTab':
            return inWorkspace ? actions.newQueryTab() : undefined
          case 'nextTab':
            return actions.cycleTab(1)
          case 'prevTab':
            return actions.cycleTab(-1)
          case 'closeTab':
            if (inWorkspace && activeTabId) return actions.closeTab(activeTabId)
            return void call('app:closeWindow')
          case 'newConnection':
            if (hasStagedEdits()) return actions.showToast('Commit or discard staged changes first.')
            if (session) return void leaveSession().then(() => setState({ screen: { name: 'aws-wizard' } }))
            return setState({ screen: { name: 'aws-wizard' } })
          case 'checkForUpdates':
            return void checkForUpdatesNow()
          case 'disconnect':
            if (hasStagedEdits()) return actions.showToast('Commit or discard staged changes first.')
            return session ? void leaveSession() : undefined
          default:
            return actions.dispatchTabCommand(command)
        }
      }),
    []
  )
  useEffect(
    () =>
      onEvent('session:lost', ({ sessionId, reason }) => {
        if (getState().session?.id !== sessionId) return
        void recoverSession(sessionId, reason) // retries with backoff, keeps tabs
      }),
    []
  )

  return (
    <ErrorBoundary>
      {screen.name === 'workspace' ? (
        <Workspace />
      ) : (
        <div className="flex h-full flex-col">
          <EnvironmentBar tier="unknown" />
          <div className="h-8 shrink-0 [-webkit-app-region:drag]" />
          <div className="min-h-0 flex-1">{screen.name === 'aws-wizard' ? <AwsWizard /> : <ConnectionsHome />}</div>
        </div>
      )}
      <CommandPalette />
      <SettingsDialog />
      <UpdateBanner />
      <Toaster />
    </ErrorBoundary>
  )
}
