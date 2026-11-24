/**
 * Edit every field of a saved connection: name, database, route (Direct /
 * SSM tunnel), auth (password / RDS IAM), user, password (blank = keep the
 * saved one), TLS, environment, and AWS profile/region. Test before saving.
 */
import { useEffect, useState } from 'react'
import { PlugZap } from 'lucide-react'
import type { SavedConnection } from '@shared/types/connection'
import type { AppError } from '@shared/types/result'
import type { EnvironmentTier } from '@shared/environment'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Field, Input, Select, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions } from '@renderer/lib/store'
import { editDraftToRequest, savedToEditDraft, validateEditDraft, type EditDraft } from './editDraft'

export function EditConnectionDialog({ connection, onClose, onSaved }: { connection: SavedConnection | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<EditDraft | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  useEffect(() => {
    setD(connection ? savedToEditDraft(connection) : null)
    setError(null)
    setOk(null)
  }, [connection])
  if (!connection || !d) return null

  const set = (patch: Partial<EditDraft>): void => {
    setD({ ...d, ...patch })
    setOk(null)
  }
  const invalid = validateEditDraft(d)
  const run = async (kind: 'test' | 'save'): Promise<void> => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'test') setOk(`Connected · PostgreSQL ${(await call('db:testConnection', editDraftToRequest(d))).serverVersion}`)
      else {
        await call('connections:save', editDraftToRequest(d))
        actions.showToast(`Saved “${d.name}”`)
        onSaved()
        onClose()
      }
    } catch (e) {
      setError(asAppError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit connection" description={connection.name} className="max-w-xl">
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-3">
            <Field label="Name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          </div>
          <div className="col-span-3">
            <Field label="Database"><Input value={d.database} onChange={(e) => set({ database: e.target.value })} spellCheck={false} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="Network path">
              <Select value={d.routeKind} onChange={(e) => set({ routeKind: e.target.value as EditDraft['routeKind'] })}>
                <option value="direct">Direct</option>
                <option value="ssm-tunnel">SSM tunnel</option>
              </Select>
            </Field>
          </div>
          <div className="col-span-3">
            <Field label={d.routeKind === 'ssm-tunnel' ? 'RDS endpoint' : 'Host'}><Input value={d.host} onChange={(e) => set({ host: e.target.value })} spellCheck={false} /></Field>
          </div>
          <div className="col-span-1">
            <Field label="Port"><Input value={d.port} onChange={(e) => set({ port: e.target.value })} inputMode="numeric" /></Field>
          </div>
          {d.routeKind === 'ssm-tunnel' && (
            <div className="col-span-6">
              <Field label="SSM tunnel host (EC2 instance id)">
                <Input value={d.targetInstanceId} onChange={(e) => set({ targetInstanceId: e.target.value })} placeholder="i-0abc123…" spellCheck={false} />
              </Field>
            </div>
          )}
          <div className="col-span-2">
            <Field label="Authentication">
              <Select value={d.authKind} onChange={(e) => set({ authKind: e.target.value as EditDraft['authKind'] })}>
                <option value="rds-iam">RDS IAM token</option>
                <option value="password">Password</option>
              </Select>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="User"><Input value={d.user} onChange={(e) => set({ user: e.target.value })} spellCheck={false} /></Field>
          </div>
          <div className="col-span-2">
            {d.authKind === 'password' && (
              <Field label="Password">
                <Input type="password" value={d.password} placeholder={d.hasSavedPassword ? '•••••• (unchanged)' : ''} onChange={(e) => set({ password: e.target.value })} />
              </Field>
            )}
          </div>
          <div className="col-span-2">
            <Field label="AWS profile"><Input value={d.awsProfile} onChange={(e) => set({ awsProfile: e.target.value })} spellCheck={false} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="AWS region"><Input value={d.awsRegion} onChange={(e) => set({ awsRegion: e.target.value })} spellCheck={false} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="TLS">
              <Select value={d.tlsMode} onChange={(e) => set({ tlsMode: e.target.value as EditDraft['tlsMode'] })}>
                <option value="verify-full">verify-full</option>
                <option value="require">require</option>
                <option value="disable">disable</option>
              </Select>
            </Field>
          </div>
          <div className="col-span-6">
            <Field label="Environment">
              <Select value={d.environment ?? ''} onChange={(e) => set({ environment: (e.target.value || null) as EnvironmentTier | null })}>
                <option value="">Auto-detect from names</option>
                <option value="prod">prod (read-only by default)</option>
                <option value="staging">staging (read-only by default)</option>
                <option value="dev">dev (read-write)</option>
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
          <Button disabled={!!invalid || !!busy} onClick={() => void run('save')}>
            {busy === 'save' && <Spinner className="text-primary-foreground" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
