/**
 * Wizard step 1: pick an AWS profile and region, and make sure its credentials
 * work. An SSO profile with a missing or expired token gets an inline "Sign in
 * with AWS SSO" button, which runs `aws sso login` in main and advances
 * automatically when it completes.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, LogIn } from 'lucide-react'
import type { AwsProfile, CallerIdentity } from '@shared/types/aws'
import { Button } from '@renderer/components/ui/button'
import { Badge, Field, Input, Select, Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'
import { useAsync } from '@renderer/lib/useAsync'
import { AWS_REGIONS } from '../regions'
import { wizardRegionKey } from '../connectionDraft'

export interface ProfileSelection {
  profile: string
  region: string
  identity: CallerIdentity
}

export function StepProfile({ initial, onNext }: { initial: Partial<ProfileSelection>; onNext: (s: ProfileSelection) => void }) {
  const profiles = useAsync(() => call('aws:listProfiles'), [])
  const tools = useAsync(() => call('aws:checkCliTools'), [])
  const [profileName, setProfileName] = useState(initial.profile ?? '')
  const [region, setRegion] = useState(initial.region ?? '')
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<ReturnType<typeof asAppError> | null>(null)

  const profile: AwsProfile | undefined = profiles.data?.find((p) => p.name === profileName)

  // Pick a sensible default profile (last used, else first SSO, else first) once loaded.
  useEffect(() => {
    if (!profiles.data?.length || profileName) return
    void call('prefs:get', { key: 'wizard.lastProfile' }).then((last) => {
      const lastName = typeof last === 'string' ? last : null
      const pick =
        profiles.data?.find((p) => p.name === lastName) ?? profiles.data?.find((p) => p.kind === 'sso') ?? profiles.data?.[0]
      if (pick) setProfileName(pick.name)
    })
  }, [profiles.data, profileName])

  // Region: what you last used with this profile, else the profile's configured region.
  useEffect(() => {
    if (!profile || initial.region) return
    void call('prefs:get', { key: wizardRegionKey(profile.name) })
      .catch(() => null)
      .then((saved) => setRegion(typeof saved === 'string' && saved ? saved : (profile.region ?? 'us-east-1')))
  }, [profile, initial.region])

  const sso = useAsync(() => call('aws:getSsoStatus', { profile: profileName }), [profileName], !!profileName)
  const ssoReady = sso.data && (sso.data.state === 'valid' || sso.data.state === 'not-sso')
  const identity = useAsync(
    () => call('aws:getCallerIdentity', { profile: profileName, region }),
    [profileName, region, sso.data?.state],
    !!profileName && !!region && !!ssoReady
  )

  async function signIn(): Promise<void> {
    setSigningIn(true)
    setSignInError(null)
    try {
      await call('aws:ssoLogin', { profile: profileName })
      await sso.reload()
    } catch (err) {
      setSignInError(asAppError(err))
    } finally {
      setSigningIn(false)
    }
  }

  function next(): void {
    if (!identity.data) return
    void call('prefs:set', { key: 'wizard.lastProfile', value: profileName })
    void call('prefs:set', { key: wizardRegionKey(profileName), value: region })
    onNext({ profile: profileName, region, identity: identity.data })
  }

  if (profiles.error) return <ErrorBanner error={profiles.error} />
  if (profiles.data && profiles.data.length === 0) {
    return (
      <ErrorBanner
        error={{
          code: 'AWS_CREDENTIALS_MISSING',
          message: 'No AWS profiles found in ~/.aws/config or ~/.aws/credentials.',
          hint: 'Create an SSO profile, then come back to this screen.',
          command: 'aws configure sso',
          docsUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/sso-configure-profile-token.html'
        }}
      />
    )
  }

  const needsSignIn = sso.data && (sso.data.state === 'missing' || sso.data.state === 'expired')

  return (
    <div className="space-y-4">
      {tools.data && !tools.data.awsCli && (
        <ErrorBanner
          error={{
            code: 'AWS_CLI_MISSING',
            message: 'The AWS CLI was not found. SSO sign-in and VPC tunnels need it.',
            hint: 'Install AWS CLI v2, then reopen this screen.',
            command: navigator.platform.toLowerCase().includes('mac') ? 'brew install awscli' : undefined,
            docsUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="AWS profile">
          <Select value={profileName} onChange={(e) => setProfileName(e.target.value)} disabled={!profiles.data}>
            {profiles.data?.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.kind}){p.ssoAccountId ? ` · ${p.ssoAccountId}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Region">
          <Input list="aws-regions" value={region} onChange={(e) => {
              const r = e.target.value.trim()
              setRegion(r)
              // Remember complete region codes per profile (not half-typed ones).
              if (profileName && /^[a-z]{2}(-[a-z]+)+-\d$/.test(r)) void call('prefs:set', { key: wizardRegionKey(profileName), value: r })
            }} spellCheck={false} />
          <datalist id="aws-regions">
            {AWS_REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="min-h-16 rounded-md border bg-background/40 p-3">
        {(sso.loading || identity.loading) && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Checking credentials…
          </div>
        )}
        {needsSignIn && !signingIn && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-amber-400" />
              <span>
                SSO session {sso.data?.state === 'expired' ? 'expired' : 'not signed in'} for <b>{profileName}</b>.
              </span>
            </div>
            <Button size="sm" onClick={() => void signIn()}>
              <LogIn /> Sign in with AWS SSO
            </Button>
          </div>
        )}
        {signingIn && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Spinner /> Complete the sign-in in your browser…
            </div>
            <Button size="sm" variant="ghost" onClick={() => void call('aws:cancelSsoLogin', { profile: profileName })}>
              Cancel
            </Button>
          </div>
        )}
        {identity.data && !identity.loading && (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <span className="truncate">
              Authenticated as <span className="font-mono text-[11px]">{identity.data.arn}</span>
            </span>
            <Badge>{identity.data.accountId}</Badge>
          </div>
        )}
        {signInError && <ErrorBanner error={signInError} />}
        {identity.error && !identity.loading && <ErrorBanner error={identity.error} onRetry={() => void sso.reload()} />}
        {sso.error && <ErrorBanner error={sso.error} />}
      </div>

      <div className="flex justify-end">
        <Button onClick={next} disabled={!identity.data || identity.loading}>
          Next: choose database
        </Button>
      </div>
    </div>
  )
}
