/**
 * Editing an existing saved connection: SavedConnection ⇄ flat form draft ⇄
 * SaveConnectionRequest. Pure and unit-tested. An empty password field means
 * "keep the stored secret" (connections:save keeps the existing secretRef).
 */
import type { SavedConnection, SaveConnectionRequest } from '@shared/types/connection'
import { classifyEnvironment, type EnvironmentTier } from '@shared/environment'

export interface EditDraft {
  id: string
  name: string
  database: string
  routeKind: 'direct' | 'ssm-tunnel'
  host: string
  port: string
  targetInstanceId: string
  authKind: 'password' | 'rds-iam'
  user: string
  /** Blank = keep the saved password. */
  password: string
  hasSavedPassword: boolean
  tlsMode: SavedConnection['tlsMode']
  environment: EnvironmentTier | null
  awsProfile: string
  awsRegion: string
  rdsIdentifier: string | null
}

export function savedToEditDraft(c: SavedConnection): EditDraft {
  return {
    id: c.id,
    name: c.name,
    database: c.database,
    routeKind: c.route.kind,
    host: c.route.kind === 'direct' ? c.route.host : c.route.rdsHost,
    port: String(c.route.kind === 'direct' ? c.route.port : c.route.rdsPort),
    targetInstanceId: c.route.kind === 'ssm-tunnel' ? c.route.targetInstanceId : '',
    authKind: c.auth.kind,
    user: c.auth.user,
    password: '',
    hasSavedPassword: c.auth.kind === 'password' && !!c.auth.secretRef,
    tlsMode: c.tlsMode,
    environment: c.environment,
    awsProfile: c.aws?.profile ?? '',
    awsRegion: c.aws?.region ?? '',
    rdsIdentifier: c.aws?.rdsIdentifier ?? null
  }
}

export function validateEditDraft(d: EditDraft): string | null {
  const port = Number(d.port)
  if (!d.name.trim()) return 'Name is required.'
  if (!d.host.trim()) return 'Host is required.'
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be 1–65535.'
  if (!d.database.trim() || !d.user.trim()) return 'Database and user are required.'
  if (d.routeKind === 'ssm-tunnel' && !/^(i|mi)-[0-9a-f]+$/.test(d.targetInstanceId.trim())) return 'SSM tunnel needs an instance id like i-0abc123.'
  const needsAws = d.routeKind === 'ssm-tunnel' || d.authKind === 'rds-iam'
  if (needsAws && (!d.awsProfile.trim() || !d.awsRegion.trim())) return 'IAM auth and SSM tunnels need an AWS profile and region.'
  if (d.authKind === 'password' && !d.hasSavedPassword && !d.password) return 'Enter a password.'
  if (d.authKind === 'rds-iam' && d.tlsMode === 'disable') return 'IAM auth requires TLS.'
  return null
}

export function editDraftToRequest(d: EditDraft): SaveConnectionRequest {
  const port = Number(d.port)
  const hasAws = d.awsProfile.trim() !== '' && d.awsRegion.trim() !== ''
  return {
    connection: {
      id: d.id,
      name: d.name.trim(),
      engine: 'postgres',
      database: d.database.trim(),
      route:
        d.routeKind === 'ssm-tunnel'
          ? { kind: 'ssm-tunnel', targetInstanceId: d.targetInstanceId.trim(), rdsHost: d.host.trim(), rdsPort: port }
          : { kind: 'direct', host: d.host.trim(), port },
      // secretRef is resolved in main: blank password keeps the existing one.
      auth: d.authKind === 'rds-iam' ? { kind: 'rds-iam', user: d.user.trim() } : { kind: 'password', user: d.user.trim(), secretRef: null },
      tlsMode: d.tlsMode,
      aws: hasAws ? { profile: d.awsProfile.trim(), region: d.awsRegion.trim(), rdsIdentifier: d.rdsIdentifier } : null,
      environment: d.environment
    },
    ...(d.authKind === 'password' && d.password ? { password: d.password } : {})
  }
}

/** Effective environment of a saved connection (manual override, else name heuristics). */
export function connectionEnvironment(c: SavedConnection): EnvironmentTier {
  const host = c.route.kind === 'direct' ? c.route.host : c.route.rdsHost
  return c.environment ?? classifyEnvironment(c.name, c.aws?.profile, c.aws?.rdsIdentifier, host)
}
