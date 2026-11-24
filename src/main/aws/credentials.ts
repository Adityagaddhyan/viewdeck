/**
 * Per-profile credential providers and SDK client cache.
 *
 * Why we memoise: `fromIni` with SSO calls `sso:GetRoleCredentials` on every
 * invocation. The RDS signer resolves credentials for every new pooled
 * connection, so without a cache each new connection would make an extra network
 * call. We reuse resolved credentials until 5 minutes before they expire, and
 * never cache a failure.
 *
 * `ignoreCache: true` makes the SDK re-read ~/.aws on each (uncached) resolve,
 * so profiles edited while the app is running are picked up.
 */
import { fromIni } from '@aws-sdk/credential-providers'
import { EC2Client } from '@aws-sdk/client-ec2'
import { RDSClient } from '@aws-sdk/client-rds'
import { SSMClient } from '@aws-sdk/client-ssm'
import { STSClient } from '@aws-sdk/client-sts'
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types'

const REFRESH_MARGIN_MS = 5 * 60 * 1000

export type ProviderFactory = (profile: string) => AwsCredentialIdentityProvider

const defaultProviderFactory: ProviderFactory = (profile) => fromIni({ profile, ignoreCache: true })

/** Wraps a provider so it reuses credentials until shortly before they expire. */
export function memoizeCredentials(
  provider: AwsCredentialIdentityProvider,
  now: () => number = Date.now
): AwsCredentialIdentityProvider & { invalidate(): void } {
  let cached: AwsCredentialIdentity | null = null
  let inflight: Promise<AwsCredentialIdentity> | null = null

  const memo = (async () => {
    if (cached && (!cached.expiration || cached.expiration.getTime() - now() > REFRESH_MARGIN_MS)) {
      return cached
    }
    // Coalesce concurrent resolves (e.g. a pool opening 5 connections at once).
    inflight ??= provider()
      .then((creds) => {
        cached = creds
        return creds
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }) as AwsCredentialIdentityProvider & { invalidate(): void }
  memo.invalidate = () => {
    cached = null
  }
  return memo
}

/**
 * Process-wide cache of credential providers and SDK clients, keyed by profile
 * (and region, for clients). Main-process singleton. See services.ts.
 */
export class AwsClientFactory {
  private readonly providers = new Map<string, ReturnType<typeof memoizeCredentials>>()
  private readonly clients = new Map<string, unknown>()

  constructor(private readonly providerFactory: ProviderFactory = defaultProviderFactory) {}

  credentials(profile: string): AwsCredentialIdentityProvider {
    let p = this.providers.get(profile)
    if (!p) {
      p = memoizeCredentials(this.providerFactory(profile))
      this.providers.set(profile, p)
    }
    return p
  }

  /** Drop cached credentials, e.g. right after a fresh `aws sso login`. */
  invalidate(profile: string): void {
    this.providers.get(profile)?.invalidate()
  }

  rds(profile: string, region: string): RDSClient {
    return this.client('rds', profile, region, (c) => new RDSClient(c))
  }
  ec2(profile: string, region: string): EC2Client {
    return this.client('ec2', profile, region, (c) => new EC2Client(c))
  }
  ssm(profile: string, region: string): SSMClient {
    return this.client('ssm', profile, region, (c) => new SSMClient(c))
  }
  sts(profile: string, region: string): STSClient {
    return this.client('sts', profile, region, (c) => new STSClient(c))
  }

  private client<T>(
    svc: string,
    profile: string,
    region: string,
    make: (cfg: { region: string; credentials: AwsCredentialIdentityProvider }) => T
  ): T {
    const key = `${svc}|${profile}|${region}`
    let c = this.clients.get(key) as T | undefined
    if (!c) {
      c = make({ region, credentials: this.credentials(profile) })
      this.clients.set(key, c)
    }
    return c
  }
}
