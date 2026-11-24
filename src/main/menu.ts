/**
 * Native application menu + app identity (name, About panel, dock icon).
 *
 * Menu items that mirror in-app shortcuts (Cmd+Enter, Cmd+S, Cmd+F, Cmd+K,
 * Cmd+T) use `registerAccelerator: false`: the shortcut is SHOWN in the menu but
 * not grabbed by it, so Monaco and the grid keep receiving those keys. Clicking
 * the item sends a `menu:command` push event that the renderer executes
 * (App.tsx → actions.dispatchCommand).
 */
import { app, BrowserWindow, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'
import { broadcast } from './ipc/events'
import { resourcePath } from './resources'

const send = (command: MenuCommand) => (): void => broadcast('menu:command', { command })
/** Shown in the menu, handled by the renderer's own key handlers (not grabbed by the menu). */
const shown = (accelerator: string): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> => ({ accelerator, registerAccelerator: false })

export function setupAppIdentity(): void {
  app.setName('ViewDeck')
  app.setAboutPanelOptions({
    applicationName: 'ViewDeck',
    applicationVersion: app.getVersion(),
    copyright: 'Keyboard-first, AWS-native database GUI',
    iconPath: resourcePath('icon.png')
  })
  if (process.platform === 'darwin' && !app.isPackaged) {
    // Packaged builds take the icon from the bundle. In dev, show ours instead of Electron's.
    const icon = nativeImage.createFromPath(resourcePath('icon.png'))
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  }
}

export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'ViewDeck',
            submenu: [
              { role: 'about' as const, label: 'About ViewDeck' },
              { type: 'separator' as const },
              { id: 'settings', label: 'Settings…', accelerator: 'Cmd+,', click: send('settings') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide ViewDeck' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit ViewDeck' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { id: 'newQueryTab', label: 'New Query Tab', ...shown('CmdOrCtrl+T'), click: send('newQueryTab') },
        { id: 'newConnection', label: 'New AWS Connection…', click: send('newConnection') },
        { type: 'separator' },
        // Cmd+W closes the active tab (renderer). With no tabs, it closes the window.
        { id: 'closeTab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
        { id: 'disconnect', label: 'Disconnect', click: send('disconnect') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { id: 'settings', label: 'Settings…', accelerator: 'Ctrl+,', click: send('settings') }, { role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Query',
      submenu: [
        { id: 'runStatement', label: 'Run Statement / Selection', ...shown('CmdOrCtrl+Enter'), click: send('runStatement') },
        { id: 'cancelQuery', label: 'Cancel Running Query', click: send('cancelQuery') },
        { type: 'separator' },
        { id: 'reviewChanges', label: 'Review Staged Changes…', ...shown('CmdOrCtrl+S'), click: send('reviewChanges') },
        { id: 'focusFilter', label: 'Filter Rows…', ...shown('CmdOrCtrl+F'), click: send('focusFilter') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { id: 'palette', label: 'Command Palette…', ...shown('CmdOrCtrl+K'), click: send('palette') },
        { id: 'nextTab', label: 'Next Tab', ...shown('Ctrl+Tab'), click: send('nextTab') },
        { id: 'prevTab', label: 'Previous Tab', ...shown('Ctrl+Shift+Tab'), click: send('prevTab') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}

/** Installs the menu. Cmd+W with no open tabs falls back to closing the window (handled in renderer). */
export function installAppMenu(): void {
  Menu.setApplicationMenu(buildAppMenu())
}

/** Used by the renderer's "close window" fallback. */
export function closeFocusedWindow(): void {
  BrowserWindow.getFocusedWindow()?.close()
}
