import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TunnelInfo } from '@shared/types/aws'
import { ChildProcessRegistry } from '../process/ChildProcessRegistry'
import { createFakeChild, type FakeChild } from '../testing/fakeChild'
import { SsmTunnelManager } from './SsmTunnelManager'

const REQ = {
  profile: 'acme-prod',
  region: 'us-east-1',
  targetInstanceId: 'i-abc',
  remoteHost: 'orders.abc.us-east-1.rds.amazonaws.com',
  remotePort: 5432
}
afterEach(() => vi.restoreAllMocks())
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function setup(opts: { plugin?: boolean; ports?: number[]; readyTimeoutMs?: number } = {}) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const c = createFakeChild()
    children.push(c)
    return c
  })
  const registry = new ChildProcessRegistry(spawn, 'darwin')
  // Fake children: route group signals to the fake's kill().
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: NodeJS.Signals) => {
    children.find((c) => c.pid === -pid)?.kill(sig)
    return true
  }) as typeof process.kill)
  const statuses: TunnelInfo[] = []
  const ports = [...(opts.ports ?? [50001, 50002, 50003])]
  const mgr = new SsmTunnelManager({
    registry,
    onStatus: (s) => statuses.push(s),
    detectTools: () => ({ awsCli: '/usr/local/bin/aws', sessionManagerPlugin: opts.plugin === false ? null : '/x/session-manager-plugin' }),
    allocatePort: async () => ports.shift() ?? 59999,
    readyTimeoutMs: opts.readyTimeoutMs ?? 5000,
    env: { PATH: '/usr/bin' }
  })
  return { mgr, spawn, children, statuses, registry }
}

describe('SsmTunnelManager', () => {
  it('spawns the port-forwarding session and resolves when ready', async () => {
    const { mgr, spawn, children, statuses } = setup()
    const p = mgr.open(REQ)
    await tick()
    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1]
    expect(args).toEqual(
      expect.arrayContaining(['start-session', '--target', 'i-abc', 'AWS-StartPortForwardingSessionToRemoteHost', '--profile', 'acme-prod', '--region', 'us-east-1'])
    )
    expect(JSON.parse(args[args.indexOf('--parameters') + 1] as string)).toEqual({
      host: [REQ.remoteHost],
      portNumber: ['5432'],
      localPortNumber: ['50001']
    })
    children[0]?.emitStdout('Starting session with SessionId: x\nPort 50001 opened for sessionId x.\nWaiting for connections...\n')
    const info = await p
    expect(info).toMatchObject({ state: 'ready', localHost: '127.0.0.1', localPort: 50001 })
    expect(statuses.map((s) => s.state)).toEqual(['starting', 'ready'])
    expect(mgr.list()).toHaveLength(1)
  })

  it('retries on a new port when the local port is taken', async () => {
    const { mgr, children } = setup()
    const p = mgr.open(REQ)
    await tick()
    children[0]?.emitStderr('listen tcp 127.0.0.1:50001: bind: address already in use\n')
    await tick()
    children[0]?.finish(1)
    await tick()
    await tick()
    children[1]?.emitStdout('Waiting for connections...\n')
    await expect(p).resolves.toMatchObject({ localPort: 50002 })
  })

  it('fails fast with SSM_PLUGIN_MISSING when the plugin is not installed', async () => {
    const { mgr, spawn } = setup({ plugin: false })
    await expect(mgr.open(REQ)).rejects.toMatchObject({ appError: { code: 'SSM_PLUGIN_MISSING' } })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('classifies TargetNotConnected', async () => {
    const { mgr, children } = setup()
    const p = mgr.open(REQ)
    await tick()
    children[0]?.emitStderr('An error occurred (TargetNotConnected) when calling the StartSession operation: i-abc is not connected.\n')
    await tick()
    children[0]?.finish(254)
    await expect(p).rejects.toMatchObject({ appError: { code: 'SSM_TUNNEL_FAILED', message: expect.stringContaining('not connected') } })
    expect(mgr.list()).toEqual([])
  })

  it('marks a ready tunnel failed if the process dies unexpectedly', async () => {
    const { mgr, children, statuses } = setup()
    const p = mgr.open(REQ)
    await tick()
    children[0]?.emitStdout('Waiting for connections...\n')
    await p
    children[0]?.finish(0)
    await tick()
    expect(statuses.at(-1)).toMatchObject({ state: 'failed' })
    expect(mgr.list()).toEqual([])
  })

  it('close() kills the process group and emits closed', async () => {
    const { mgr, children, statuses, registry } = setup()
    const p = mgr.open(REQ)
    await tick()
    children[0]?.emitStdout('Waiting for connections...\n')
    const info = await p
    await mgr.close(info.id)
    expect(process.kill).toHaveBeenCalledWith(-(children[0]?.pid as number), 'SIGTERM')
    expect(statuses.at(-1)).toMatchObject({ state: 'closed' })
    expect(registry.size).toBe(0)
  })

  it('times out if never ready', async () => {
    const { mgr } = setup({ readyTimeoutMs: 20 })
    await expect(mgr.open(REQ)).rejects.toMatchObject({ appError: { code: 'SSM_TUNNEL_FAILED', message: expect.stringContaining('did not become ready') } })
  })
})
