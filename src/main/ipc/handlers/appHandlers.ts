import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { AppErrorException } from '../toAppError'
import { closeFocusedWindow } from '../../menu'
import { registerHandler } from '../registry'

/** `app:*` channels: process and runtime metadata. */
export function registerAppHandlers(): void {
  registerHandler('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
    userDataPath: app.getPath('userData')
  }))

  registerHandler('app:saveFile', async (req) => {
    if (typeof req?.content !== 'string' || typeof req.defaultName !== 'string') {
      throw new AppErrorException({ code: 'VALIDATION', message: 'saveFile needs defaultName and content' })
    }
    const name = basename(req.defaultName).replace(/[^\w.\- ]/g, '_') || 'export.txt'
    // E2E: write straight into a test directory instead of driving the native dialog.
    const e2eDir = process.env['VIEWDECK_E2E_SAVE_DIR']
    let path: string | undefined
    if (e2eDir) path = join(e2eDir, name)
    else {
      const win = BrowserWindow.getFocusedWindow()
      const res = win
        ? await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), name) })
        : await dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), name) })
      path = res.canceled ? undefined : res.filePath
    }
    if (!path) return { path: null }
    await writeFile(path, req.content, 'utf8')
    return { path }
  })

  registerHandler('app:closeWindow', () => closeFocusedWindow())

  registerHandler('app:writeClipboard', (req) => {
    if (typeof req?.text !== 'string' || req.text.length > 50_000_000) {
      throw new AppErrorException({ code: 'VALIDATION', message: 'Clipboard text must be a string under 50 MB' })
    }
    clipboard.writeText(req.text)
  })
}
