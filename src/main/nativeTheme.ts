/**
 * Keeps Electron's native theme in step with the app's `theme` setting, so
 * native menus, context menus, dialogs and the window background match the
 * renderer. "system" hands control back to macOS (follows Light/Dark/Auto).
 */
import { BrowserWindow, nativeTheme } from 'electron'
import type { AppSettings } from '@shared/settings'

/** Window background before/under the renderer (matches --background in globals.css). */
export const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#09090b' : '#fafafa')

/** Applies the setting to nativeTheme and repaints open windows' background. */
export function applyNativeTheme(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
}
