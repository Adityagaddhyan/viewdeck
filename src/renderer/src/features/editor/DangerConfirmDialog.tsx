/**
 * Confirmation for destructive SQL in an unlocked session (dangerGuard.ts).
 * On prod the user must type the database name to enable "Run anyway".
 */
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/primitives'
import type { Danger } from './dangerGuard'

export function DangerConfirmDialog({
  pending,
  database,
  environment,
  onCancel,
  onConfirm
}: {
  pending: { sql: string; dangers: Danger[] } | null
  database: string
  environment: string
  onCancel: () => void
  onConfirm: (sql: string) => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [pending])
  if (!pending) return null
  const needsTyping = environment === 'prod'
  const ok = !needsTyping || typed.trim() === database

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title="Run destructive SQL?" description={`${environment.toUpperCase()} · ${database}`} className="max-w-lg">
        <div className="space-y-2 text-xs">
          {pending.dangers.map((d, i) => (
            <div key={i} className="space-y-1 rounded border border-red-500/30 bg-red-500/10 p-2">
              <div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-200">
                <AlertTriangle className="size-3.5" /> {d.reason}
              </div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-800/80 dark:text-red-100/80 select-text">{d.statement}</pre>
            </div>
          ))}
          {needsTyping && (
            <label className="block space-y-1 pt-1">
              <span className="text-muted-foreground">
                This is a <b className="text-red-600 dark:text-red-300">production</b> database. Type <code className="text-foreground">{database}</code> to confirm.
              </span>
              <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the database name to confirm" />
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} autoFocus={!needsTyping}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!ok} onClick={() => onConfirm(pending.sql)}>
            Run anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
