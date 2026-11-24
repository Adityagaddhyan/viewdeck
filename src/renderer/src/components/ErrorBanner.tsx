/**
 * Renders an AppError as an actionable banner:
 *   message → hint → numbered troubleshooting `steps` → copyable `command`
 *   → docs link → expandable raw `detail`.
 *
 * Code-specific inline actions:
 *   AWS_SSO_EXPIRED (with context.profile): a "Sign in with AWS SSO" button
 *   runs aws:ssoLogin, then calls `onRetry` so the failed action re-runs.
 */
import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Copy, ExternalLink, LogIn } from 'lucide-react'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/primitives'
import { asAppError, call } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="group inline-flex max-w-full items-center gap-1.5 rounded bg-black/30 px-1.5 py-0.5 text-left font-mono text-[11px] text-red-50 hover:bg-black/50"
      onClick={() => {
        void navigator.clipboard.writeText(command)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-3 shrink-0 text-emerald-400" /> : <Copy className="size-3 shrink-0 opacity-70 group-hover:opacity-100" />}
      <span className="truncate select-text">{command}</span>
    </button>
  )
}

function SsoSignIn({ profile, onRetry }: { profile: string; onRetry?: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [err, setErr] = useState<string | null>(null)
  async function signIn(): Promise<void> {
    setState('busy')
    setErr(null)
    try {
      await call('aws:ssoLogin', { profile })
      setState('done')
      onRetry?.()
    } catch (e) {
      setErr(asAppError(e).message)
      setState('idle')
    }
  }
  if (state === 'done') return <span className="text-[11px] text-emerald-600 dark:text-emerald-300">Signed in{onRetry ? '. Retrying…' : '. Try again.'}</span>
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => void signIn()} disabled={state === 'busy'}>
        {state === 'busy' ? <Spinner className="text-primary-foreground" /> : <LogIn />}
        {state === 'busy' ? 'Finish in your browser…' : 'Sign in with AWS SSO'}
      </Button>
      {state === 'busy' && (
        <Button size="sm" variant="ghost" onClick={() => void call('aws:cancelSsoLogin', { profile })}>
          Cancel
        </Button>
      )}
      {err && <span className="text-[11px] text-red-600 dark:text-red-300">{err}</span>}
    </div>
  )
}

export function ErrorBanner({
  error,
  className,
  action,
  onRetry
}: {
  error: AppError
  className?: string
  action?: React.ReactNode
  /** Re-runs the failed operation (used after an inline fix such as SSO sign-in). */
  onRetry?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ssoProfile = error.code === 'AWS_SSO_EXPIRED' ? error.context?.profile : undefined

  return (
    <div className={cn('rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs', className)} role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium text-red-700 dark:text-red-200 select-text">{error.message}</p>
          {error.hint && <p className="text-red-700/75 dark:text-red-200/75 select-text">{error.hint}</p>}
          {error.steps && error.steps.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-4 text-red-800/75 dark:text-red-100/75 select-text">
              {error.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {(error.command || error.docsUrl || ssoProfile) && (
            <div className="flex flex-wrap items-center gap-2">
              {ssoProfile && <SsoSignIn profile={ssoProfile} onRetry={onRetry} />}
              {error.command && <CopyCommand command={error.command} />}
              {error.docsUrl && (
                // target=_blank: main's window-open handler routes https links to the OS browser.
                <a href={error.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-red-700/70 dark:text-red-200/70 underline-offset-2 hover:text-red-100 hover:underline">
                  <ExternalLink className="size-3" /> Docs
                </a>
              )}
            </div>
          )}
          {error.detail && (
            <div>
              <button className="inline-flex items-center gap-0.5 text-red-700/60 dark:text-red-200/60 hover:text-red-200" onClick={() => setOpen(!open)}>
                <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} /> Details
              </button>
              {open && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] text-red-800/80 dark:text-red-100/80 select-text">
                  {error.detail}
                </pre>
              )}
            </div>
          )}
        </div>
        {action}
      </div>
    </div>
  )
}
