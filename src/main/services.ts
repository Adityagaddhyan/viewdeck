/**
 * Composition root: the single place main-process service singletons are built
 * and wired together. IPC handlers get services from here. Tests construct
 * services directly with fakes instead.
 *
 * Must first be called after `app.whenReady()` (userData path and safeStorage
 * need a ready app). `registerAllIpcHandlers()` is that first call.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { broadcast } from './ipc/events'
import { ChildProcessRegistry } from './process/ChildProcessRegistry'
import { AwsClientFactory } from './aws/credentials'
import { AwsProfileService } from './aws/AwsProfileService'
import { RdsDiscoveryService } from './aws/RdsDiscoveryService'
import { RdsIamSignerService } from './aws/RdsIamSignerService'
import { SsmTunnelManager } from './aws/SsmTunnelManager'
import { TunnelTargetService } from './aws/TunnelTargetService'
import { DriverFactory } from './drivers/DriverFactory'
import { SessionManager } from './db/SessionManager'
import { LocalStore } from './store/LocalStore'
import { rdsCaBundle } from './resources'
import { normalizeSettings } from '@shared/settings'

/** In-memory secrets for db:testConnection with an unsaved password. Never persisted. */
export class TransientSecrets {
  private readonly map = new Map<string, string>()
  put(plain: string): string {
    const ref = `transient:${randomUUID()}`
    this.map.set(ref, plain)
    return ref
  }
  get(ref: string): string | undefined {
    return this.map.get(ref)
  }
  delete(ref: string): void {
    this.map.delete(ref)
  }
}

export interface Services {
  processes: ChildProcessRegistry
  awsClients: AwsClientFactory
  profiles: AwsProfileService
  rdsDiscovery: RdsDiscoveryService
  tunnelTargets: TunnelTargetService
  tunnels: SsmTunnelManager
  iamSigner: RdsIamSignerService
  store: LocalStore
  transientSecrets: TransientSecrets
  drivers: DriverFactory
  sessions: SessionManager
}

let services: Services | null = null

/** True once getServices() has run, so quit hooks don't build services just to tear them down. */
export function servicesStarted(): boolean {
  return services !== null
}

export function getServices(): Services {
  if (services) return services
  const processes = new ChildProcessRegistry()
  const awsClients = new AwsClientFactory()
  const iamSigner = new RdsIamSignerService((p) => awsClients.credentials(p))
  const store = new LocalStore(join(app.getPath('userData'), 'viewdeck.sqlite'), safeStorage)
  const transientSecrets = new TransientSecrets()

  const drivers = new DriverFactory({
    resolvePassword: async (ref) => transientSecrets.get(ref) ?? store.secrets.get(ref),
    iamPasswordProvider: (auth) =>
      iamSigner.createPasswordProvider({
        profile: auth.awsProfile,
        region: auth.region,
        hostname: auth.rdsHost,
        port: auth.rdsPort,
        username: auth.user
      }),
    rdsCaBundle
  })

  // Built before the tunnel manager so tunnel status can feed it.
  let sessions: SessionManager | null = null
  const tunnels = new SsmTunnelManager({
    registry: processes,
    onStatus: (info) => {
      broadcast('tunnel:status', info)
      sessions?.handleTunnelStatus(info)
    }
  })
  sessions = new SessionManager({
    createDriver: (engine) => drivers.create(engine),
    openTunnel: (req) => tunnels.open(req),
    closeTunnel: (id) => tunnels.close(id),
    onSessionLost: (sessionId, reason) => broadcast('session:lost', { sessionId, reason }),
    getSettings: () => normalizeSettings(store.preferences.get('settings'))
  })

  services = {
    processes,
    awsClients,
    profiles: new AwsProfileService({ registry: processes }),
    rdsDiscovery: new RdsDiscoveryService((p, r) => awsClients.rds(p, r)),
    tunnelTargets: new TunnelTargetService({
      ec2: (p, r) => awsClients.ec2(p, r),
      ssm: (p, r) => awsClients.ssm(p, r)
    }),
    tunnels,
    iamSigner,
    store,
    transientSecrets,
    drivers,
    sessions
  }
  return services
}
