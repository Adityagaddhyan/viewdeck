import { useEffect, useRef } from 'react'

/**
 * Global keyboard shortcut. `combo` is like "mod+s" or "mod+enter", where
 * mod = Cmd on macOS and Ctrl elsewhere. `ctrl` means the literal Control key
 * on every platform (e.g. "ctrl+tab" to cycle tabs, as in browsers). The latest handler is always used,
 * without re-binding. Pass `enabled=false` for inactive tabs.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]
    const wantMod = parts.includes('mod')
    const wantCtrl = parts.includes('ctrl')
    const wantShift = parts.includes('shift')
    const isMac = navigator.platform.toLowerCase().includes('mac')
    const onKey = (e: KeyboardEvent): void => {
      if (wantCtrl) {
        if (!e.ctrlKey || e.metaKey || e.shiftKey !== wantShift) return
      } else {
        const mod = isMac ? e.metaKey : e.ctrlKey
        if (mod !== wantMod || e.shiftKey !== wantShift) return
      }
      if (e.key.toLowerCase() !== key) return
      e.preventDefault()
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, enabled])
}

export const MOD_LABEL = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'
