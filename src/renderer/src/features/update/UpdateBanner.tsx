/**
 * Floating update card (bottom-right, every screen), driven by `update:status`:
 * - available → "Update now" (one-click download + verify) or "Download" when the app
 *   can't update itself (dev build, running from the DMG, read-only folder).
 * - downloading → progress bar.
 * - ready → "Restart now" (asks first if there are staged edits) or "Later" (installed on quit).
 * - error after an update attempt → retry, or the release page.
 * "Later" hides the card until the next check.
 */
import { useEffect, useState } from 'react'
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { RELEASES_PAGE, type UpdateStatus } from '@shared/update'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@renderer/components/ConfirmDialog'
import { call, onEvent } from '@renderer/lib/ipc'
import { hasStagedEdits } from '@renderer/lib/sessions'

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    void call('update:getStatus').then(setStatus).catch(() => {})
    return onEvent('update:status', (s) => {
      if (s.state === 'checking' || s.state === 'downloading') setHidden(false)
      setStatus(s)
    })
  }, [])

  if (!status || hidden) return null
  const show = status.state === 'available' || status.state === 'downloading' || status.state === 'ready' || (status.state === 'error' && status.release)
  if (!show) return null

  const restart = (): void => {
    const go = (): void => void call('update:restart')
    if (hasStagedEdits()) {
      setConfirm({
        title: 'Restart to update?',
        body: 'Some table tabs have staged edits that have not been committed. Restarting discards them.',
        confirmLabel: 'Discard and restart',
        destructive: true,
        onConfirm: go
      })
    } else go()
  }
  const later = <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>Later</Button>
  const notesUrl = 'release' in status && status.release ? status.release.url : RELEASES_PAGE

  return (
    <>
      <div role="status" aria-label="Update" className="fixed bottom-9 right-4 z-50 w-80 rounded-lg border bg-popover p-3 text-[12px] text-popover-foreground shadow-xl">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-500" />
          <div className="min-w-0 flex-1">
            {status.state === 'available' && (
              <>
                <div className="font-medium">ViewDeck {status.release.version} is available</div>
                <div className="text-muted-foreground">
                  You have {status.current}.{' '}
                  <a href={status.release.url} target="_blank" rel="noreferrer" className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
                    What's new
                  </a>
                </div>
                {!status.canInstall && status.reason && <div className="mt-1 text-muted-foreground">{status.reason}</div>}
                <div className="mt-2 flex justify-end gap-1.5">
                  {later}
                  {status.canInstall ? (
                    <Button size="sm" onClick={() => void call('update:download')}>
                      <Download /> Update now
                    </Button>
                  ) : (
                    <Button size="sm" asChild>
                      <a href={status.release.url} target="_blank" rel="noreferrer">
                        <Download /> Download
                      </a>
                    </Button>
                  )}
                </div>
              </>
            )}
            {status.state === 'downloading' && (
              <>
                <div className="font-medium">Downloading ViewDeck {status.release.version}…</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${status.percent}%` }} />
                </div>
                <div className="mt-1 text-right tabular-nums text-muted-foreground">{status.percent}%</div>
              </>
            )}
            {status.state === 'ready' && (
              <>
                <div className="font-medium">ViewDeck {status.release.version} is ready</div>
                <div className="text-muted-foreground">Restart to finish updating. If you choose Later, it installs when you quit.</div>
                <div className="mt-2 flex justify-end gap-1.5">
                  {later}
                  <Button size="sm" onClick={restart}>
                    <RefreshCw /> Restart now
                  </Button>
                </div>
              </>
            )}
            {status.state === 'error' && (
              <>
                <div className="font-medium">The update didn't finish</div>
                <div className="text-muted-foreground">{status.message}</div>
                <div className="mt-2 flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" asChild>
                    <a href={notesUrl} target="_blank" rel="noreferrer">Download manually</a>
                  </Button>
                  <Button size="sm" onClick={() => void call('update:check')}>Try again</Button>
                </div>
              </>
            )}
          </div>
          {status.state !== 'downloading' && (
            <button onClick={() => setHidden(true)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
