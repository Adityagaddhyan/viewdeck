/**
 * Saved connection profiles (persisted in LocalStore) and live sessions.
 * A SavedConnection never contains a secret, only a `secretRef` pointer to a
 * safeStorage-encrypted blob in the `secrets` table.
 */
import type { DatabaseEngine, DriverCapabilities } from './driver'
import type { EnvironmentTier } from '../environment'

/** How the socket reaches the database. */
export type ConnectionRoute =
  | { kind: 'direct'; host: string; port: number }
  | {
      kind: 'ssm-tunnel'
      targetInstanceId: string
      /** Real RDS endpoint, reachable from the target instance. */
      rdsHost: string
      rdsPort: number
    }

export type ConnectionAuth =
  | { kind: 'password'; user: string; secretRef: string | null }
  | { kind: 'rds-iam'; user: string }

export interface SavedConnection {
  id: string
  name: string
  engine: DatabaseEngine
  database: string
  route: ConnectionRoute
  auth: ConnectionAuth
  tlsMode: 'disable' | 'require' | 'verify-full'
  /** AWS context. Required for rds-iam auth and ssm-tunnel routes. */
  aws: { profile: string; region: string; rdsIdentifier: string | null } | null
  /** Manual override of the name-based environment heuristic. */
  environment: EnvironmentTier | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

/** Input for connections:save. `password` is encrypted in main and never stored as plaintext. */
export interface SaveConnectionRequest {
  connection: Omit<SavedConnection, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt'> & { id?: string }
  /** Plaintext password for `password` auth. Omit to keep the existing secret. */
  password?: string
}

/** A live, connected session in main. */
export interface SessionInfo {
  id: string
  connectionId: string | null
  name: string
  engine: DatabaseEngine
  database: string
  /** Database user and the real server host (the RDS endpoint even when tunnelled). */
  user: string
  host: string
  capabilities: DriverCapabilities
  readOnly: boolean
  /** Current server-side statement timeout in ms (0 = off). */
  statementTimeoutMs: number
  environment: EnvironmentTier
  serverVersion: string
  /** Set when connected through an SSM tunnel. */
  tunnelId: string | null
  connectedAt: string
}

/** A starred query. `connectionId` null = shown on every connection. */
export interface SavedQuery {
  id: string
  connectionId: string | null
  name: string
  sql: string
  createdAt: string
  updatedAt: string
}

export interface QueryHistoryEntry {
  id: number
  connectionId: string | null
  sql: string
  executedAt: string
  durationMs: number | null
  rowCount: number | null
  error: string | null
}
