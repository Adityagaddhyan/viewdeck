/**
 * Header theme picker: Light / Dark / System. The icon shows the current mode;
 * a choice applies and saves immediately (no Settings dialog round trip).
 */
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { useAppState } from '@renderer/lib/store'
import { setTheme, type ThemeMode } from '@renderer/lib/theme'

/** The three modes, in menu order (also used by the command palette). */
export const THEME_MODES: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor }
]

export function ThemeMenu() {
  const theme = useAppState((s) => s.settings.theme)
  const current = THEME_MODES.find((m) => m.mode === theme) ?? THEME_MODES[1]!
  const Icon = current.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current.label}`} title={`Theme: ${current.label}`}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {THEME_MODES.map(({ mode, label, icon: I }) => (
          <DropdownMenuItem key={mode} onSelect={() => void setTheme(mode)}>
            <I /> {label}
            {mode === 'system' && <span className="text-[10px] text-muted-foreground">follows macOS</span>}
            {mode === theme && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
