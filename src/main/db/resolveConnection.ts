/**
 * Turns a SavedConnection (what the user configured) into a
 * DriverConnectionConfig (what the driver needs), opening an SSM tunnel when
 * the route requires one.
 *
 * This is where the "socket host vs. real host" split is decided:
 *   ssm-tunnel → socket 127.0.0.1:<local port>, tls.servername = RDS host,
 *                IAM token signed for RDS host:port
 *   direct     → socket = TLS name = signing host
 */
import type { SavedConnection } from '@shared/types/connection'
import type { DriverAuth, DriverConnectionConfig } from '@shared/types/driver'
import type { OpenTunnelRequest, TunnelInfo } from '@shared/types/aws'
import { classifyEnvironment, type EnvironmentTier } from '@shared/environment'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { AppErrorException } from '../ipc/toAppError'

export interface ResolvedConnection {
  config: DriverConnectionConfig
  environment: EnvironmentTier
  tunnel: TunnelInfo | null
}

const RDS_HOST = /\.rds\.amazonaws\.com(\.cn)?$/i

export function environmentFor(conn: SavedConnection): EnvironmentTier {
  const realHost = conn.route.kind === 'direct' ? conn.route.host : conn.route.rdsHost
  return conn.environment ?? classifyEnvironment(conn.name, conn.aws?.profile, conn.aws?.rdsIdentifier, realHost)
}

export async function resolveConnection(
  conn: SavedConnection,
  openTunnel: (req: OpenTunnelRequest) => Promise<TunnelInfo>,
  settings: AppSettings = DEFAULT_SETTINGS
): Promise<ResolvedConnection> {
  const environment = environmentFor(conn)
  const realHost = conn.route.kind === 'direct' ? conn.route.host : conn.route.rdsHost
  const realPort = conn.route.kind === 'direct' ? conn.route.port : conn.route.rdsPort

  if ((conn.route.kind === 'ssm-tunnel' || conn.auth.kind === 'rds-iam') && !conn.aws) {
    throw new AppErrorException({ code: 'VALIDATION', message: 'This connection needs an AWS profile and region.' })
  }

  let auth: DriverAuth
  if (conn.auth.kind === 'rds-iam') {
    const aws = conn.aws as NonNullable<SavedConnection['aws']>
    auth = { kind: 'rds-iam', user: conn.auth.user, awsProfile: aws.profile, region: aws.region, rdsHost: realHost, rdsPort: realPort }
  } else {
    if (!conn.auth.secretRef) {
      throw new AppErrorException({ code: 'VALIDATION', message: 'No password saved for this connection.', hint: 'Edit the connection and enter a password.' })
    }
    auth = { kind: 'password', user: conn.auth.user, secretRef: conn.auth.secretRef }
  }

  let tunnel: TunnelInfo | null = null
  let host = realHost
  let port = realPort
  if (conn.route.kind === 'ssm-tunnel') {
    const aws = conn.aws as NonNullable<SavedConnection['aws']>
    tunnel = await openTunnel({
      profile: aws.profile,
      region: aws.region,
      targetInstanceId: conn.route.targetInstanceId,
      remoteHost: conn.route.rdsHost,
      remotePort: conn.route.rdsPort
    })
    host = tunnel.localHost
    port = tunnel.localPort
  }

  return {
    environment,
    tunnel,
    config: {
      engine: conn.engine,
      host,
      port,
      database: conn.database,
      auth,
      tls: {
        mode: conn.tlsMode,
        // Tunnels: pin the TLS name to the real RDS host (the socket is 127.0.0.1).
        // Direct: buildTlsOptions infers it from the socket host and skips IPs (no IP SNI).
        servername: conn.route.kind === 'ssm-tunnel' ? realHost : undefined,
        useRdsCaBundle: RDS_HOST.test(realHost) || conn.aws !== null
      },
      // Per-tier defaults from Settings (default policy: everything but dev starts locked).
      readOnly: settings.readOnlyDefaults[environment],
      statementTimeoutMs: settings.timeoutDefaults[environment]
    }
  }
}
