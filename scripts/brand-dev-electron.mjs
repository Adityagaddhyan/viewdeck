#!/usr/bin/env node
/**
 * macOS shows the bundle's CFBundleName as the bold app name in the menu bar,
 * Cmd+Tab and the dock. `app.setName()` can't change that. In `npm run dev` /
 * `preview` the bundle is node_modules/electron/dist/Electron.app, so the menu
 * bar said "Electron". This renames that dev bundle to ViewDeck and re-signs it
 * ad hoc (editing Info.plist invalidates the existing signature).
 * Packaged builds get the name from electron-builder and don't need this.
 * Runs from `postinstall` after install-electron. Idempotent; no-op off macOS.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'ViewDeck'
if (process.platform !== 'darwin') process.exit(0)
const appDir = join(import.meta.dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = join(appDir, 'Contents', 'Info.plist')
if (!existsSync(plist)) {
  console.warn('brand-dev-electron: Electron.app not found, skipping')
  process.exit(0)
}

const read = (key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

if (read('CFBundleName') === NAME && read('CFBundleDisplayName') === NAME) process.exit(0)
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  execFileSync('plutil', ['-replace', key, '-string', NAME, plist])
}
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' })
console.log(`brand-dev-electron: dev Electron.app now shows as "${NAME}"`)
