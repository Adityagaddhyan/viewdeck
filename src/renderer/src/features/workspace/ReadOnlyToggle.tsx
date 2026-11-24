/**
 * One-click read-only lock (ADR-003). Locking is instant. Unlocking a
 * non-dev session asks for confirmation first, because that is the moment
 * mistakes on prod become possible. The state is enforced by the server
 * (db:setReadOnly → SET default_transaction_read_only).
 */
import { useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'

export function ReadOnlyToggle() {
  const session = useAppState((s) => s.session)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  if (!session) return null

  async function apply(readOnly: boolean): Promise<void> {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      actions.updateSession(await call('db:setReadOnly', { sessionId: session.id, readOnly }))
      setConfirming(false)
    } catch (err) {
      setError(asAppError(err))
    } finally {
      setBusy(false)
    }
  }

  const onClick = (): void => {
    if (session.readOnly && session.environment !== 'dev') setConfirming(true)
    else void apply(!session.readOnly)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={busy}
        className={cn(session.readOnly ? 'text-muted-foreground' : 'border-amber-500/50 text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200')}
        title={session.readOnly ? 'Read-only (server-enforced). Click to allow writes.' : 'Writes allowed. Click to lock.'}
      >
        {busy ? <Spinner /> : session.readOnly ? <Lock /> : <LockOpen />}
        {session.readOnly ? 'Read-only' : 'Read-write'}
      </Button>
      {error && !confirming && <span className="text-[11px] text-red-400">{error.message}</span>}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent title={`Allow writes on ${session.environment.toUpperCase()}?`} description={`${session.name} · ${session.database}`}>
          <p className="text-xs text-muted-foreground">
            This connection is classified as <b className="text-foreground">{session.environment}</b>. Unlocking lets the SQL editor and grid
            change data. Staged grid edits still need review before commit.
          </p>
          {error && <ErrorBanner className="mt-3" error={error} />}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep read-only
            </Button>
            <Button variant="destructive" onClick={() => void apply(false)} disabled={busy}>
              {busy && <Spinner className="text-white" />} Unlock writes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
