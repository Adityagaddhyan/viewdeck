/**
 * AWS-facing DTOs shared by main and renderer. All are plain serializable data.
 * Secrets (keys, tokens) never appear in these types.
 */

/** Where a profile's credentials come from, as declared in ~/.aws. */
export type AwsProfileKind = 'sso' | 'static' | 'assume-role' | 'process' | 'other'

export interface AwsProfile {
  name: string
  kind: AwsProfileKind
  region: string | null
  /** SSO only: `sso_session` name (modern config) or null (legacy inline SSO config). */
  ssoSession: string | null
  ssoStartUrl: string | null
  ssoAccountId: string | null
  ssoRoleName: string | null
  /** assume-role only: the profile this one chains from. */
  sourceProfile: string | null
  /** Files the profile was found in. */
  sources: Array<'config' | 'credentials'>
}

/**
 * Local SSO token state, read from ~/.aws/sso/cache without network calls.
 * `valid` only means the cached token has not expired. Role credentials can still be
 * denied, so a failure is reported separately when credentials are first used.
 */
export type SsoTokenState = 'valid' | 'expired' | 'missing' | 'not-sso'

export interface SsoStatus {
  profile: string
  state: SsoTokenState
  /** ISO timestamp of token expiry, when known. */
  expiresAt: string | null
}

export interface CallerIdentity {
  accountId: string
  arn: string
  userId: string
}

/** A Postgres-compatible RDS target: a standalone instance or a cluster. */
export interface RdsDatabase {
  /** DBInstanceIdentifier or DBClusterIdentifier. */
  identifier: string
  kind: 'instance' | 'cluster'
  /** e.g. `postgres`, `aurora-postgresql`. */
  engine: string
  engineVersion: string
  status: string
  /** Writer endpoint hostname. Null while the resource is still provisioning. */
  endpoint: string | null
  readerEndpoint: string | null
  port: number
  publiclyAccessible: boolean
  vpcId: string | null
  iamAuthEnabled: boolean
  /** Initial database name, if one was set at creation. */
  databaseName: string | null
  masterUsername: string | null
  region: string
}

/** An EC2 instance that can host an SSM port-forwarding session. */
export interface TunnelTarget {
  instanceId: string
  name: string | null
  privateIp: string | null
  vpcId: string | null
  platform: string | null
  agentVersion: string | null
}

export interface OpenTunnelRequest {
  profile: string
  region: string
  /** EC2 instance id that forwards traffic. */
  targetInstanceId: string
  /** Real RDS endpoint and port (reachable from the target instance). */
  remoteHost: string
  remotePort: number
}

export type TunnelState = 'starting' | 'ready' | 'closed' | 'failed'

export interface TunnelInfo {
  id: string
  state: TunnelState
  localHost: '127.0.0.1'
  localPort: number
  remoteHost: string
  remotePort: number
  targetInstanceId: string
  profile: string
  region: string
  /** Set when state is `failed`. */
  error: string | null
  startedAt: string
}
