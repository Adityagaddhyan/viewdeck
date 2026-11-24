import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/update'
import { SWAP_SCRIPT, UpdateInstaller, type RunResult } from './UpdateInstaller'
import { UpdateService } from './UpdateService'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const release = (tag: string, extra: Partial<Record<string, unknown>> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/x/releases/tag/${tag}`,
  body: 'notes',
  published_at: '2026-12-01T00:00:00Z',
  draft: false,
  prerelease: false,
  assets: [
    { name: `ViewDeck-${tag.slice(1)}-arm64-mac.zip`, browser_download_url: 'https://dl/zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://dl/sums' }
  ],
  ...extra
})

function makeService(fetchImpl: (url: string) => Promise<Response>, opts: { appBundle?: string | null; installer?: Partial<UpdateInstaller> } = {}) {
  const statuses: UpdateStatus[] = []
  const installer = { prepare: vi.fn(async () => {}), installAfterExit: vi.fn(() => true), stagedVersion: null, ...opts.installer } as unknown as UpdateInstaller
  const svc = new UpdateService({
    fetch: ((url: string) => fetchImpl(url)) as typeof fetch,
    installer,
    currentVersion: '0.1.0',
    arch: 'arm64',
    appBundle: opts.appBundle ?? null,
    autoCheckEnabled: () => true,
    onStatus: (s) => statuses.push(s),
    disableTimers: true
  })
  return { svc, statuses, installer }
}

describe('UpdateService.check', () => {
  it('stays idle when there is no release yet or nothing newer', async () => {
    expect((await makeService(async () => json({}, 404)).svc.check()).state).toBe('idle')
    expect((await makeService(async () => json(release('v0.1.0'))).svc.check()).state).toBe('idle')
    expect((await makeService(async () => json(release('v0.2.0', { prerelease: true }))).svc.check()).state).toBe('idle')
  })

  it('reports a newer release; without an installable bundle it offers the download page', async () => {
    const { svc, statuses } = makeService(async () => json(release('v0.2.0')))
    const s = await svc.check()
    expect(s).toMatchObject({ state: 'available', canInstall: false, release: { version: '0.2.0' } })
    expect(statuses.map((x) => x.state)).toEqual(['checking', 'available'])
  })

  it('allows one-click install when the bundle is in a writable folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-upd-'))
    const app = join(dir, 'ViewDeck.app')
    mkdirSync(app)
    const s = await makeService(async () => json(release('v0.2.0')), { appBundle: app }).svc.check()
    expect(s).toMatchObject({ state: 'available', canInstall: true })
  })

  it('refuses one-click install from a DMG / translocated copy', async () => {
    const s = await makeService(async () => json(release('v0.2.0')), { appBundle: '/Volumes/ViewDeck 0.1.0/ViewDeck.app' }).svc.check()
    expect(s).toMatchObject({ state: 'available', canInstall: false, reason: expect.stringMatching(/Applications/) })
  })

  it('turns network failures into an error status instead of throwing', async () => {
    const s = await makeService(async () => {
      throw new Error('offline')
    }).svc.check()
    expect(s).toMatchObject({ state: 'error', message: expect.stringMatching(/offline/) })
  })
})

describe('UpdateService download → restart', () => {
  it('stages the update, then installs on quit and relaunches only after Restart now', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-upd-'))
    const app = join(dir, 'ViewDeck.app')
    mkdirSync(app)
    const { svc, installer } = makeService(async () => json(release('v0.2.0')), { appBundle: app })
    await svc.check()
    expect((await svc.download()).state).toBe('ready')
    expect(svc.requestRestart()).toBe(true)
    expect(svc.installOnQuit()).toBe(true)
    expect(installer.installAfterExit).toHaveBeenCalledWith(app, true)
  })
})

describe('UpdateInstaller.prepare', () => {
  const zip = Buffer.from('fake zip bytes')
  const good = createHash('sha256').update(zip).digest('hex')
  const assets = { version: '0.2.0', zipName: 'ViewDeck-0.2.0-arm64-mac.zip', zipUrl: 'https://dl/zip', sumsUrl: 'https://dl/sums' }
  const run = (id = 'dev.viewdeck.app', ver = '0.2.0') =>
    vi.fn(async (cmd: string, args: string[]): Promise<RunResult> => {
      if (cmd === 'plutil') return { code: 0, stdout: args[1] === 'CFBundleIdentifier' ? id : ver, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    })
  const fetchWith = (hash: string) =>
    (async (url: string) => (url.endsWith('sums') ? new Response(`${hash}  ViewDeck-0.2.0-arm64-mac.zip\n`) : new Response(zip, { headers: { 'content-length': String(zip.length) } }))) as unknown as typeof fetch

  it('verifies the checksum, signature and bundle identity, then stages it', async () => {
    const progress: number[] = []
    const inst = new UpdateInstaller({ fetch: fetchWith(good), run: run(), spawnAfterExit: vi.fn(), workDir: mkdtempSync(join(tmpdir(), 'vd-inst-')), pid: 1 })
    await inst.prepare(assets, (p) => progress.push(p))
    expect(inst.stagedVersion).toBe('0.2.0')
    expect(progress.at(-1)).toBe(100)
  })

  it('rejects a checksum mismatch or the wrong app', async () => {
    const mk = (hash: string, r = run()) => new UpdateInstaller({ fetch: fetchWith(hash), run: r, spawnAfterExit: vi.fn(), workDir: mkdtempSync(join(tmpdir(), 'vd-inst-')), pid: 1 })
    await expect(mk('0'.repeat(64)).prepare(assets, () => {})).rejects.toThrow(/checksum/)
    await expect(mk(good, run('com.evil.app')).prepare(assets, () => {})).rejects.toThrow(/not the expected app/)
  })
})

describe('SWAP_SCRIPT (real shell)', () => {
  it('waits for the app to exit, swaps the bundle and removes the old one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-swap-'))
    const target = join(dir, 'ViewDeck.app')
    const staged = join(dir, 'staged', 'ViewDeck.app')
    mkdirSync(target)
    mkdirSync(staged, { recursive: true })
    writeFileSync(join(target, 'version'), 'old')
    writeFileSync(join(staged, 'version'), 'new')
    // The "app": an orphaned process (like a quitting app, it is reaped by init, not by us).
    const pid = spawnSync('/bin/sh', ['-c', 'sleep 0.4 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).stdout.trim()
    const started = Date.now()
    const r = spawnSync('/bin/sh', ['-c', SWAP_SCRIPT, 'viewdeck-update', pid, staged, target, '0'], { encoding: 'utf8' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250) // it waited for the app to exit
    expect(r.status).toBe(0)
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('new')
    expect(existsSync(`${target}.previous-update`)).toBe(false)
    expect(existsSync(staged)).toBe(false)
  })

  it('keeps the old app if the new bundle is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-swap-'))
    const target = join(dir, 'ViewDeck.app')
    mkdirSync(target)
    writeFileSync(join(target, 'version'), 'old')
    const r = spawnSync('/bin/sh', ['-c', SWAP_SCRIPT, 'viewdeck-update', '999999', join(dir, 'missing.app'), target, '0'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('old')
  })
})
