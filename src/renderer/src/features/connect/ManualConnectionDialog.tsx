/**
 * Host/port/password connection form, e.g. for local Docker Postgres.
 *
 * "Save & connect" saves first, then connects. The dialog can't be dismissed
 * mid-flight (a late error would land in a closed dialog: bug B1). The home
 * list reloads as soon as the save lands, and a retry after a failed connect
 * updates the same saved connection instead of creating a duplicate.
 */
import { useEffect, useState } from 'react'
import { PlugZap } from 'lucide-react'
import type { AppError } from '@shared/types/result'
import type { EnvironmentTier } from '@shared/environment'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Field, Input, Select, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { connectTo } from '@renderer/lib/sessions'
import { defaultManualDraft, manualDraftToRequest, validateManualDraft, type ManualDraft } from './connectionDraft'

export function ManualConnectionDialog({
  open,
  onOpenChange,
  onSaved
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Called once the connection is saved (even if connecting then fails). */
  onSaved?: () => void
}) {
  const [d, setD] = useState<ManualDraft>(defaultManualDraft)
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  useEffect(() => {
    if (open) return
    setSavedId(null) // next open starts a new connection
    setError(null)
    setOk(null)
  }, [open])
  const set = (patch: Partial<ManualDraft>): void => {
    setD((x) => ({ ...x, ...patch }))
    setOk(null)
  }
  const invalid = validateManualDraft(d)

  async function run(kind: 'test' | 'connect'): Promise<void> {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'test') {
        const { serverVersion } = await call('db:testConnection', manualDraftToRequest(d))
        setOk(`Connected · PostgreSQL ${serverVersion}`)
      } else {
        const req = manualDraftToRequest(d)
        const saved = await call('connections:save', savedId ? { ...req, connection: { ...req.connection, id: savedId } } : req)
        setSavedId(saved.id)
        onSaved?.()
        try {
          await connectTo(saved.id)
        } catch (err) {
          const e = asAppError(err)
          setError({ ...e, message: `Saved "${saved.name}", but connecting failed: ${e.message}` })
          return
        }
        onOpenChange(false)
      }
    } catch (err) {
      setError(asAppError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o || !busy) && onOpenChange(o)}>
      <DialogContent title="Manual connection" description="Connect with host, port and password (e.g. local Docker).">
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-6">
            <Field label="Name">
              <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-4">
            <Field label="Host">
              <Input value={d.host} onChange={(e) => set({ host: e.target.value })} spellCheck={false} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Port">
              <Input value={d.port} onChange={(e) => set({ port: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="Database">
              <Input value={d.database} onChange={(e) => set({ database: e.target.value })} spellCheck={false} />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="User">
              <Input value={d.user} onChange={(e) => set({ user: e.target.value })} spellCheck={false} />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="Password">
              <Input type="password" value={d.password} onChange={(e) => set({ password: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="TLS">
              <Select value={d.tlsMode} onChange={(e) => set({ tlsMode: e.target.value as ManualDraft['tlsMode'] })}>
                <option value="disable">disable</option>
                <option value="require">require (no verification)</option>
                <option value="verify-full">verify-full</option>
              </Select>
            </Field>
          </div>
          <div className="col-span-6">
            <Field label="Environment">
              <Select value={d.environment ?? ''} onChange={(e) => set({ environment: (e.target.value || null) as EnvironmentTier | null })}>
                <option value="">Auto-detect from name</option>
                <option value="prod">prod</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </Select>
            </Field>
          </div>
        </div>
        {error && <ErrorBanner className="mt-3" error={error} />}
        {ok && <p className="mt-3 text-xs text-emerald-400">{ok}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          {invalid && <span className="mr-auto text-[11px] text-muted-foreground">{invalid}</span>}
          <Button variant="outline" disabled={!!invalid || !!busy} onClick={() => void run('test')}>
            {busy === 'test' ? <Spinner /> : <PlugZap />} Test
          </Button>
          <Button disabled={!!invalid || !!busy} onClick={() => void run('connect')}>
            {busy === 'connect' && <Spinner className="text-primary-foreground" />} Save & connect
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
