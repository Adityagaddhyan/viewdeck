/**
 * Theme: applies the `theme` setting (dark / light / system) to <html> (Tailwind
 * `dark` class + `color-scheme`, so scrollbars and form controls match), picks
 * the Monaco theme, and saves a new choice. "system" follows the OS live
 * (prefers-color-scheme), including when macOS switches at sunset.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { AppSettings } from '@shared/settings'
import { call } from './ipc'
import { actions, getState, useAppState } from './store'

export type ThemeMode = AppSettings['theme']

const query = (): MediaQueryList | undefined => (typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)'))

function subscribeSystem(cb: () => void): () => void {
  const mq = query()
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}

/** Whether the OS is in dark mode, re-rendering when it changes. */
export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeSystem, () => query()?.matches ?? true)
}

export function resolveDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** Whether the app is currently dark (setting + OS). */
export function useIsDark(): boolean {
  const theme = useAppState((s) => s.settings.theme)
  return resolveDark(theme, useSystemDark())
}

/** Keeps <html class="dark"> in sync with the setting (and the OS, for "system"). Returns isDark. */
export function useApplyTheme(): boolean {
  const dark = useIsDark()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])
  return dark
}

/** Monaco theme id for the current setting. */
export function useMonacoTheme(): string {
  return useIsDark() ? 'viewdeck-dark' : 'viewdeck-light'
}

/** Saves a theme choice right away (main also updates the native window theme). */
export async function setTheme(theme: ThemeMode): Promise<void> {
  const prev = getState().settings
  actions.setSettings({ ...prev, theme }) // instant, before the round trip
  try {
    actions.setSettings(await call('settings:set', { settings: { ...prev, theme } }))
  } catch (err) {
    actions.setSettings(prev)
    actions.showToast(`Could not save theme: ${(err as Error).message}`)
  }
}
