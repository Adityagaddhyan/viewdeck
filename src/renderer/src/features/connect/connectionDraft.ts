/**
 * Pure helpers that turn wizard and manual-form state into a
 * SaveConnectionRequest. Kept free of React so they are unit-tested.
 */
import type { RdsDatabase } from '@shared/types/aws'
import type { SaveConnectionRequest } from '@shared/types/connection'
import { classifyEnvironment, type EnvironmentTier } from '@shared/environment'

export interface AwsDraft {
  profile: string
  region: string
  db: RdsDatabase
  name: string
  database: string
  user: string
  authKind: 'rds-iam' | 'password'
  password: string
  /**
   * How the socket reaches the database. Public databases default to `direct`,
   * private ones to `ssm-tunnel`. A private database is also reachable `direct`
   * when the user's network already routes to the VPC (corporate VPN,
   * peering, Direct Connect). Many teams connect that way with plain psql.
   */
  routeKind: 'direct' | 'ssm-tunnel'
  /** Required when routeKind is `ssm-tunnel`. */
  tunnelTargetId: string | null
  environment: EnvironmentTier | null
}

export function defaultAwsDraft(profile: string, region: string, db: RdsDatabase): AwsDraft {
  return {
    profile,
    region,
    db,
    name: db.identifier,
    database: db.databaseName ?? 'postgres',
    user: db.masterUsername ?? '',
    authKind: db.iamAuthEnabled ? 'rds-iam' : 'password',
    password: '',
    routeKind: db.publiclyAccessible ? 'direct' : 'ssm-tunnel',
    tunnelTargetId: null,
    environment: null
  }
}

/** What the wizard remembers per RDS database (keyed by profile + identifier). */
export interface WizardDbMemory {
  user?: string
  database?: string
  authKind?: AwsDraft['authKind']
  routeKind?: AwsDraft['routeKind']
  tunnelTargetId?: string | null
}

export const wizardDbKey = (profile: string, rdsIdentifier: string): string => `wizard.db:${profile}:${rdsIdentifier}`
export const wizardRouteKey = (profile: string): string => `wizard.route:${profile}`
export const wizardRegionKey = (profile: string): string => `wizard.region:${profile}`

/**
 * Applies remembered choices to a fresh draft. Per-database memory wins. For
 * a private DB seen for the first time, the profile's last route choice
 * (Direct vs SSM) is reused. Public DBs always stay direct.
 */
export function applyWizardMemory(d: AwsDraft, db: WizardDbMemory | null, profileRoute: AwsDraft['routeKind'] | null): AwsDraft {
  const out = { ...d }
  if (db?.user) out.user = db.user
  if (db?.database) out.database = db.database
  if (db?.authKind) out.authKind = db.authKind
  if (!d.db.publiclyAccessible) {
    const route = db?.routeKind ?? profileRoute
    if (route) out.routeKind = route
    if (db?.tunnelTargetId) out.tunnelTargetId = db.tunnelTargetId
  }
  return out
}

export function wizardMemoryOf(d: AwsDraft): WizardDbMemory {
  return { user: d.user, database: d.database, authKind: d.authKind, routeKind: d.routeKind, tunnelTargetId: d.tunnelTargetId }
}

/** True when the database is not publicly accessible, so a direct route needs VPN or peering. */
export function isPrivate(db: RdsDatabase): boolean {
  return !db.publiclyAccessible
}

export function detectedEnvironment(d: Pick<AwsDraft, 'name' | 'profile' | 'db'>): EnvironmentTier {
  return classifyEnvironment(d.name, d.profile, d.db.identifier, d.db.endpoint)
}

/** Returns a validation message, or null when the draft can be saved. */
export function validateAwsDraft(d: AwsDraft): string | null {
  if (!d.db.endpoint) return 'This database has no endpoint yet.'
  if (!d.name.trim()) return 'Give the connection a name.'
  if (!d.database.trim()) return 'Enter a database name.'
  if (!d.user.trim()) return 'Enter a database user.'
  if (d.routeKind === 'ssm-tunnel' && !d.tunnelTargetId) return 'Pick an SSM tunnel host, or choose Direct if you are on VPN.'
  return null
}

export function awsDraftToRequest(d: AwsDraft, existingId?: string): SaveConnectionRequest {
  const endpoint = d.db.endpoint ?? ''
  return {
    connection: {
      ...(existingId ? { id: existingId } : {}),
      name: d.name.trim(),
      engine: 'postgres',
      database: d.database.trim(),
      route:
        d.routeKind === 'ssm-tunnel' && d.tunnelTargetId
          ? { kind: 'ssm-tunnel', targetInstanceId: d.tunnelTargetId, rdsHost: endpoint, rdsPort: d.db.port }
          : { kind: 'direct', host: endpoint, port: d.db.port },
      auth: d.authKind === 'rds-iam' ? { kind: 'rds-iam', user: d.user.trim() } : { kind: 'password', user: d.user.trim(), secretRef: null },
      // RDS always offers TLS, so verify against the bundled RDS CA.
      tlsMode: 'verify-full',
      aws: { profile: d.profile, region: d.region, rdsIdentifier: d.db.identifier },
      environment: d.environment
    },
    ...(d.authKind === 'password' && d.password ? { password: d.password } : {})
  }
}

export interface ManualDraft {
  name: string
  host: string
  port: string
  database: string
  user: string
  password: string
  tlsMode: 'disable' | 'require' | 'verify-full'
  environment: EnvironmentTier | null
}

export const defaultManualDraft: ManualDraft = {
  name: 'local postgres',
  host: '127.0.0.1',
  port: '5432',
  database: 'postgres',
  user: 'postgres',
  password: '',
  tlsMode: 'disable',
  environment: null
}

export function validateManualDraft(d: ManualDraft): string | null {
  const port = Number(d.port)
  if (!d.name.trim()) return 'Give the connection a name.'
  if (!d.host.trim()) return 'Enter a host.'
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be 1–65535.'
  if (!d.database.trim() || !d.user.trim()) return 'Enter a database and user.'
  return null
}

export function manualDraftToRequest(d: ManualDraft): SaveConnectionRequest {
  return {
    connection: {
      name: d.name.trim(),
      engine: 'postgres',
      database: d.database.trim(),
      route: { kind: 'direct', host: d.host.trim(), port: Number(d.port) },
      auth: { kind: 'password', user: d.user.trim(), secretRef: null },
      tlsMode: d.tlsMode,
      aws: null,
      environment: d.environment
    },
    ...(d.password ? { password: d.password } : {})
  }
}
