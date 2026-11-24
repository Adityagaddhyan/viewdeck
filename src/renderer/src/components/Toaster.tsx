import { Check } from 'lucide-react'
import { useAppState } from '@renderer/lib/store'

/** Bottom-centre confirmation toast (actions.showToast). Announced to screen readers. */
export function Toaster() {
  const toast = useAppState((s) => s.toast)
  if (!toast) return null
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
      <div key={toast.id} className="flex items-center gap-1.5 rounded-md border bg-popover px-3 py-1.5 text-xs shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
        <Check className="size-3.5 text-emerald-400" /> {toast.text}
      </div>
    </div>
  )
}
