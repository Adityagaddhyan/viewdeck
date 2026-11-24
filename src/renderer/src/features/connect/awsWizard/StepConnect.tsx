/**
 * Wizard step 3: auth, database name, environment and, for private databases,
 * the network path: Direct (the user's network already reaches the VPC via
 * VPN/peering, like `psql` with an IAM token) or an SSM tunnel through an
 * EC2 host. Then "Test" or "Save & connect".
 */
import { useEffect, useMemo, useState } from 'react'
import { Network, PlugZap, Waypoints } from 'lucide-react'
import type { RdsDatabase } from '@shared/types/aws'
import type { AppError } from '@shared/types/result'
import { ENV_COLORS, type EnvironmentTier } from '@shared/environment'
import { Button } from '@renderer/components/ui/button'
import { Badge, Field, Input, Select, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { connectTo } from '@renderer/lib/sessions'
import { useAsync } from '@renderer/lib/useAsync'
import {
  applyWizardMemory,
  awsDraftToRequest,
  defaultAwsDraft,
  detectedEnvironment,
  isPrivate,
  validateAwsDraft,
  wizardDbKey,
  wizardMemoryOf,
  wizardRouteKey,
  type AwsDraft,
  type WizardDbMemory
} from '../connectionDraft'

export function StepConnect({ profile, region, db, onBack }: { profile: string; region: string; db: RdsDatabase; onBack: () => void }) {
  const [draft, setDraft] = useState<AwsDraft>(() => defaultAwsDraft(profile, region, db))
  // Prefill from what worked last time for this database (or this profile's route habit).
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      call('prefs:get', { key: wizardDbKey(profile, db.identifier) }).catch(() => null),
      call('prefs:get', { key: wizardRouteKey(profile) }).catch(() => null)
    ]).then(([mem, route]) => {
      if (!cancelled) setDraft((d) => applyWizardMemory(d, mem as WizardDbMemory | null, route === 'direct' || route === 'ssm-tunnel' ? route : null))
    })
    return () => {
      cancelled = true
    }
  }, [profile, db.identifier])
  const remember = (): void => {
    void call('prefs:set', { key: wizardDbKey(profile, db.identifier), value: wizardMemoryOf(draft) })
    if (isPrivate(db)) void call('prefs:set', { key: wizardRouteKey(profile), value: draft.routeKind })
  }
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [testOk, setTestOk] = useState<string | null>(null)
  const set = (patch: Partial<AwsDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setTestOk(null)
  }

  const tunnel = draft.routeKind === 'ssm-tunnel'
  const tools = useAsync(() => call('aws:checkCliTools'), [], tunnel)
  const targets = useAsync(
    async () => {
      const list = await call('aws:listTunnelTargets', { profile, region, vpcId: db.vpcId ?? '' })
      if (list[0] && !draft.tunnelTargetId) set({ tunnelTargetId: list[0].instanceId })
      return list
    },
    [profile, region, db.vpcId, tunnel],
    tunnel && !!db.vpcId
  )
  const useDirect = (): void => set({ routeKind: 'direct', tunnelTargetId: null })
  const env: EnvironmentTier = draft.environment ?? detectedEnvironment(draft)
  const invalid = validateAwsDraft(draft)
  const pluginMissing = tunnel && tools.data && !tools.data.sessionManagerPlugin

  const runTest = async (): Promise<void> => {
    setBusy('test')
    setError(null)
    try {
      const { serverVersion } = await call('db:testConnection', awsDraftToRequest(draft))
      setTestOk(`Connected · PostgreSQL ${serverVersion}`)
      remember()
    } catch (err) {
      setError(asAppError(err))
    } finally {
      setBusy(null)
    }
  }

  const saveAndConnect = async (): Promise<void> => {
    setBusy('connect')
    setError(null)
    try {
      const saved = await call('connections:save', awsDraftToRequest(draft))
      remember()
      await connectTo(saved.id)
    } catch (err) {
      setError(asAppError(err))
      setBusy(null)
    }
  }

  const targetHint = useMemo(() => {
    if (targets.loading) return 'Finding SSM-online instances in the VPC…'
    if (targets.data?.length === 0) return `No SSM-online EC2 instances in ${db.vpcId}. A running instance with the SSM agent is required.`
    return 'Traffic is forwarded through this instance with AWS Systems Manager. No SSH keys or open ports are needed.'
  }, [targets.loading, targets.data, db.vpcId])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Connection name">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Database">
          <Input value={draft.database} onChange={(e) => set({ database: e.target.value })} spellCheck={false} />
        </Field>
        <Field label="Authentication" hint={!db.iamAuthEnabled && draft.authKind === 'rds-iam' ? 'IAM auth is not enabled on this instance.' : undefined}>
          <Select value={draft.authKind} onChange={(e) => set({ authKind: e.target.value as AwsDraft['authKind'] })}>
            <option value="rds-iam">RDS IAM token (recommended)</option>
            <option value="password">Password (stored in OS keychain)</option>
          </Select>
        </Field>
        <Field label="Database user">
          <Input value={draft.user} onChange={(e) => set({ user: e.target.value })} spellCheck={false} />
        </Field>
        {draft.authKind === 'password' && (
          <Field label="Password">
            <Input type="password" value={draft.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>
        )}
        <Field label="Environment" hint="Controls the accent colour and whether the session starts read-only.">
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: ENV_COLORS[env] }} />
            <Select value={draft.environment ?? ''} onChange={(e) => set({ environment: (e.target.value || null) as EnvironmentTier | null })}>
              <option value="">Auto ({detectedEnvironment(draft)})</option>
              <option value="prod">prod (read-only by default)</option>
              <option value="staging">staging (read-only by default)</option>
              <option value="dev">dev (read-write)</option>
            </Select>
          </div>
        </Field>
      </div>

      {isPrivate(db) && (
        <div className="space-y-2 rounded-md border bg-background/40 p-3">
          <div className="flex items-center gap-2 font-medium">
            <Network className="size-3.5" /> Private database <Badge>{db.vpcId ?? 'unknown VPC'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Network path">
            {(
              [
                { kind: 'direct', icon: Network, title: 'Direct (VPN / peered network)', desc: 'Your machine already reaches the VPC. Same as psql to the endpoint.' },
                { kind: 'ssm-tunnel', icon: Waypoints, title: 'SSM tunnel', desc: 'Forward through an SSM-managed EC2 host in the VPC. No VPN needed.' }
              ] as const
            ).map((o) => (
              <button
                key={o.kind}
                role="radio"
                aria-checked={draft.routeKind === o.kind}
                onClick={() => (o.kind === 'direct' ? useDirect() : set({ routeKind: 'ssm-tunnel' }))}
                className={
                  'rounded-md border p-2 text-left transition-colors ' +
                  (draft.routeKind === o.kind ? 'border-sky-500/60 bg-sky-500/10' : 'hover:bg-accent/40')
                }
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <o.icon className="size-3.5" /> {o.title}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{o.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {tunnel && (
        <div className="space-y-2 rounded-md border bg-background/40 p-3">
          {pluginMissing && (
            <ErrorBanner
              error={{
                code: 'SSM_PLUGIN_MISSING',
                message: 'The AWS Session Manager plugin is required for private databases.',
                hint: 'Install it, then press Test. No restart needed.',
                command: navigator.platform.toLowerCase().includes('mac') ? 'brew install --cask session-manager-plugin' : undefined,
                docsUrl: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html'
              }}
            />
          )}
          <Field label="Tunnel host (SSM)" hint={targetHint}>
            <Select value={draft.tunnelTargetId ?? ''} onChange={(e) => set({ tunnelTargetId: e.target.value || null })} disabled={!targets.data?.length}>
              {targets.data?.map((t) => (
                <option key={t.instanceId} value={t.instanceId}>
                  {t.name ?? t.instanceId} · {t.instanceId} {t.privateIp ? `· ${t.privateIp}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {targets.error && (
            <ErrorBanner
              error={targets.error}
              onRetry={() => void targets.reload()}
              action={
                <Button size="sm" variant="outline" onClick={useDirect} title="Connect straight to the endpoint (VPN / peered network)">
                  Use Direct instead
                </Button>
              }
            />
          )}
          {targets.data?.length === 0 && !targets.loading && (
            <Button size="sm" variant="outline" onClick={useDirect}>
              On VPN? Use Direct instead
            </Button>
          )}
        </div>
      )}

      {error && <ErrorBanner error={error} onRetry={() => void runTest()} />}
      {testOk && <p className="text-xs text-emerald-400">{testOk}</p>}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={!!busy}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          {invalid && <span className="text-[11px] text-muted-foreground">{invalid}</span>}
          <Button variant="outline" onClick={() => void runTest()} disabled={!!invalid || !!busy}>
            {busy === 'test' ? <Spinner /> : <PlugZap />} Test
          </Button>
          <Button onClick={() => void saveAndConnect()} disabled={!!invalid || !!busy}>
            {busy === 'connect' && <Spinner className="text-primary-foreground" />} Save & connect
          </Button>
        </div>
      </div>
    </div>
  )
}
