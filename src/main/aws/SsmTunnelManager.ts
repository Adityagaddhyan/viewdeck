/**
 * Opens and tracks SSM port-forwarding tunnels to private RDS endpoints.
 *
 * Each tunnel is one child process:
 *   aws ssm start-session --target <i-…>
 *     --document-name AWS-StartPortForwardingSessionToRemoteHost
 *     --parameters {"host":["<rds>"],"portNumber":["5432"],"localPortNumber":["<free>"]}
 *
 * Lifecycle (ARCHITECTURE.md §5): starting → ready → closed | failed.
 * - Ready means the plugin printed "Waiting for connections". It only prints
 *   that after binding the local port and establishing the SSM data channel.
 * - The plugin binds `localhost`. Go prefers the IPv4 address when listening on
 *   a hostname, so connect to 127.0.0.1, never "localhost" (which can resolve to ::1).
 * - Children are spawned through ChildProcessRegistry, so app quit kills them
 *   (and the plugin grandchild) even if close() is never called.
 */
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { OpenTunnelRequest, TunnelInfo } from '@shared/types/aws'
import type { AppError } from '@shared/types/result'
import { AppErrorException } from '../ipc/toAppError'
import type { ChildProcessRegistry } from '../process/ChildProcessRegistry'
import { toAwsAppError } from './awsErrors'
import { cliEnv, detectCliTools, type CliTools } from './cliPath'
import { allocateFreePort } from './freePort'
import { awsCliMissingError, pluginMissingError } from './remediation'

export interface SsmTunnelManagerDeps {
  registry: ChildProcessRegistry
  /** Push every state change (wired to the `tunnel:status` IPC event). */
  onStatus?: (info: TunnelInfo) => void
  detectTools?: () => CliTools
  allocatePort?: () => Promise<number>
  env?: NodeJS.ProcessEnv
  readyTimeoutMs?: number
  now?: () => Date
}

const READY_MARKER = /Waiting for connections/i
const PORT_IN_USE = /address already in use|bind: .*in use|only one usage of each socket address/i
const MAX_PORT_ATTEMPTS = 3

interface TunnelEntry {
  info: TunnelInfo
  child: ChildProcess
  closing: boolean
}

export class SsmTunnelManager {
  private readonly tunnels = new Map<string, TunnelEntry>()
  private readonly detectTools: () => CliTools
  private readonly allocatePort: () => Promise<number>
  private readonly readyTimeoutMs: number
  private readonly now: () => Date

  constructor(private readonly deps: SsmTunnelManagerDeps) {
    this.detectTools = deps.detectTools ?? (() => detectCliTools({ env: deps.env }))
    this.allocatePort = deps.allocatePort ?? (() => allocateFreePort())
    this.readyTimeoutMs = deps.readyTimeoutMs ?? 30_000
    this.now = deps.now ?? (() => new Date())
  }

  list(): TunnelInfo[] {
    return [...this.tunnels.values()].map((t) => ({ ...t.info }))
  }

  get(id: string): TunnelInfo | undefined {
    const t = this.tunnels.get(id)
    return t ? { ...t.info } : undefined
  }

  /** Opens a tunnel and resolves once it is ready. Rejects with an AppErrorException. */
  async open(req: OpenTunnelRequest): Promise<TunnelInfo> {
    const tools = this.detectTools()
    if (!tools.awsCli) {
      throw new AppErrorException(awsCliMissingError('The AWS CLI (v2) is required for private VPC tunnels.'))
    }
    if (!tools.sessionManagerPlugin) throw new AppErrorException(pluginMissingError())

    let lastError: AppError | null = null
    for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt++) {
      const localPort = await this.allocatePort()
      const result = await this.tryOpen(tools.awsCli, req, localPort)
      if (result.ok) return result.info
      lastError = result.error
      if (!result.retryable) break
    }
    throw new AppErrorException(lastError ?? { code: 'SSM_TUNNEL_FAILED', message: 'Tunnel failed to start.' })
  }

  /** Closes one tunnel. Idempotent. */
  async close(id: string): Promise<void> {
    const entry = this.tunnels.get(id)
    if (!entry) return
    entry.closing = true
    await this.deps.registry.kill(entry.child)
    this.transition(entry, 'closed', null)
    this.tunnels.delete(id)
  }

  /** Closes every tunnel (graceful). The quit path also calls registry.killAllSync(). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)))
  }

  private tryOpen(
    awsCli: string,
    req: OpenTunnelRequest,
    localPort: number
  ): Promise<{ ok: true; info: TunnelInfo } | { ok: false; error: AppError; retryable: boolean }> {
    const parameters = JSON.stringify({
      host: [req.remoteHost],
      portNumber: [String(req.remotePort)],
      localPortNumber: [String(localPort)]
    })
    const child = this.deps.registry.spawn(
      awsCli,
      [
        'ssm', 'start-session',
        '--target', req.targetInstanceId,
        '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
        '--parameters', parameters,
        '--profile', req.profile,
        '--region', req.region
      ],
      { env: cliEnv({ env: this.deps.env }), stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const entry: TunnelEntry = {
      child,
      closing: false,
      info: {
        id: randomUUID(),
        state: 'starting',
        localHost: '127.0.0.1',
        localPort,
        remoteHost: req.remoteHost,
        remotePort: req.remotePort,
        targetInstanceId: req.targetInstanceId,
        profile: req.profile,
        region: req.region,
        error: null,
        startedAt: this.now().toISOString()
      }
    }
    this.tunnels.set(entry.info.id, entry)
    this.deps.onStatus?.({ ...entry.info })

    return new Promise((resolve) => {
      let output = ''
      let settled = false
      const append = (line: string): void => {
        output = (output + line + '\n').slice(-8000)
      }

      const settle = (r: Parameters<typeof resolve>[0]): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(r)
      }

      const timer = setTimeout(() => {
        const error: AppError = {
          code: 'SSM_TUNNEL_FAILED',
          message: `Tunnel via ${req.targetInstanceId} did not become ready within ${Math.round(this.readyTimeoutMs / 1000)}s.`,
          hint: 'The SSM session never reported ready.',
          steps: [
            'Check that the tunnel host is SSM-online (Systems Manager → Fleet Manager).',
            "Check that the database's security group allows the tunnel host on the database port.",
            'Check that your profile may call ssm:StartSession on this instance.'
          ],
          detail: output.trim() || undefined
        }
        this.fail(entry, error)
        void this.deps.registry.kill(child)
        settle({ ok: false, error, retryable: false })
      }, this.readyTimeoutMs)

      if (child.stdout) {
        createInterface({ input: child.stdout }).on('line', (line) => {
          append(line)
          if (!settled && READY_MARKER.test(line)) {
            this.transition(entry, 'ready', null)
            settle({ ok: true, info: { ...entry.info } })
          }
        })
      }
      if (child.stderr) createInterface({ input: child.stderr }).on('line', append)

      child.once('error', (err) => {
        const error: AppError = { code: 'AWS_CLI_MISSING', message: `Could not run the AWS CLI: ${err.message}` }
        this.fail(entry, error)
        settle({ ok: false, error, retryable: false })
      })

      child.once('exit', (code, signal) => {
        // Let readline flush the final lines before classifying the failure.
        setImmediate(() => {
          if (entry.closing) return
          const error = classifyExit(output, code, signal, req)
          this.fail(entry, error)
          settle({ ok: false, error, retryable: PORT_IN_USE.test(output) })
        })
      })
    })
  }

  private fail(entry: TunnelEntry, error: AppError): void {
    if (entry.info.state === 'failed' || entry.info.state === 'closed') return
    this.transition(entry, 'failed', error.message)
    this.tunnels.delete(entry.info.id)
  }

  private transition(entry: TunnelEntry, state: TunnelInfo['state'], error: string | null): void {
    entry.info = { ...entry.info, state, error }
    this.deps.onStatus?.({ ...entry.info })
  }
}

/** Turns CLI output from a dead tunnel into the most specific AppError we can. */
export function classifyExit(
  output: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  req: Pick<OpenTunnelRequest, 'profile' | 'targetInstanceId'>
): AppError {
  const detail = output.trim() || undefined
  if (/SessionManagerPlugin is not found/i.test(output)) return { ...pluginMissingError(), detail }
  if (/TargetNotConnected|is not connected/i.test(output)) {
    return {
      code: 'SSM_TUNNEL_FAILED',
      message: `Instance ${req.targetInstanceId} is not connected to SSM.`,
      hint: 'Pick another tunnel host, or fix this instance:',
      steps: [
        'The instance must be running with the SSM agent installed and started.',
        'Its instance profile needs the AmazonSSMManagedInstanceCore policy.',
        'It needs outbound HTTPS to the SSM endpoints (NAT gateway or ssm/ssmmessages/ec2messages VPC endpoints).'
      ],
      detail
    }
  }
  if (PORT_IN_USE.test(output)) {
    return { code: 'SSM_TUNNEL_FAILED', message: 'The local tunnel port was already in use.', detail }
  }
  const aws = toAwsAppError(new Error(output), req.profile)
  if (aws.code !== 'UNKNOWN') return { ...aws, detail }
  return {
    code: 'SSM_TUNNEL_FAILED',
    message: signal ? `Tunnel process was terminated (${signal}).` : `Tunnel process exited with code ${code ?? '?'}.`,
    detail
  }
}
