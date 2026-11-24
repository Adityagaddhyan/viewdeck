/**
 * Electron main-process entry point.
 *
 * Owns all privileged work: AWS SDK calls, child processes (SSO login, SSM
 * tunnels), database pools and local persistence. The renderer is untrusted
 * and talks to main only through the typed IPC contract (src/shared/ipc.ts).
 */
import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { registerAllIpcHandlers } from './ipc/handlers'
import { installAppMenu, setupAppIdentity } from './menu'
import { getServices, servicesStarted } from './services'
import { resourcePath } from './resources'
import { applyNativeTheme, windowBackground } from './nativeTheme'
import { normalizeSettings } from '@shared/settings'

/*
 * Test isolation (used by e2e/): must run before app 'ready'.
 * VIEWDECK_USER_DATA: separate userData dir, so tests never touch real saved connections.
 * VIEWDECK_E2E=1:     Chromium mock keychain, so safeStorage never prompts the macOS Keychain.
 */
if (process.env['VIEWDECK_USER_DATA']) app.setPath('userData', process.env['VIEWDECK_USER_DATA'])
if (process.env['VIEWDECK_E2E'] === '1') app.commandLine.appendSwitch('use-mock-keychain')

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackground(), // no white flash in dark mode, no black flash in light
    icon: resourcePath('icon.png'), // Windows / Linux taskbar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security invariants: see AGENTS.md § Invariants. Do not relax these.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Electron shows no context menu by default. Give text fields and selected text
  // the standard one. Custom in-app menus (grid, sidebar, tabs) call
  // preventDefault on the DOM event, so this only fires where nothing else
  // handled the right-click. Monaco draws its own menu.
  win.webContents.on('context-menu', (_e, params) => {
    const { isEditable, selectionText, editFlags } = params
    if (!isEditable && !selectionText.trim()) return
    const template: Electron.MenuItemConstructorOptions[] = isEditable
      ? [
          { role: 'undo', enabled: editFlags.canUndo },
          { role: 'redo', enabled: editFlags.canRedo },
          { type: 'separator' },
          { role: 'cut', enabled: editFlags.canCut },
          { role: 'copy', enabled: editFlags.canCopy },
          { role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      : [{ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' }]
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  // Open external links in the OS browser and never in a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

setupAppIdentity()

void app.whenReady().then(() => {
  installAppMenu()
  registerAllIpcHandlers()
  applyNativeTheme(normalizeSettings(getServices().store.preferences.get('settings')).theme)
  createMainWindow()
  getServices().updates.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/*
 * Child-process cleanup (AGENTS.md invariant 9). Belt and braces, because each
 * hook covers a different exit path:
 *  - before-quit: normal quit (Cmd+Q, menu). Close tunnels gracefully (SIGTERM).
 *  - will-quit:   last chance in Electron. Synchronously SIGKILL survivors.
 *  - process exit / signals: crashes, `kill`, Ctrl+C in `npm run dev`.
 */
app.on('before-quit', () => {
  if (!servicesStarted()) return
  const s = getServices()
  void s.sessions.disconnectAll()
  void s.tunnels.closeAll()
  s.updates.installOnQuit() // a staged update is swapped in once we've exited
})
app.on('will-quit', () => {
  if (!servicesStarted()) return
  const s = getServices()
  s.processes.killAllSync()
  s.store.close()
})
process.on('exit', () => {
  if (servicesStarted()) getServices().processes.killAllSync()
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    if (servicesStarted()) getServices().processes.killAllSync()
    app.quit()
  })
}
