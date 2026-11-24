/**
 * Downloads, verifies and stages an update, and swaps the app bundle after quit.
 *
 * Why not electron-updater / Squirrel.Mac: Squirrel only accepts updates signed by
 * the same Developer ID, and ViewDeck is ad-hoc signed until it has one. So:
 *  1. Download `ViewDeck-<v>-<arch>-mac.zip` from the GitHub Release, hashing as it streams.
 *  2. Compare with the release's SHA256SUMS.txt (both fetched over TLS from GitHub).
 *  3. `ditto` extracts it, `codesign --verify --deep --strict` checks the bundle is intact,
 *     and the Info.plist must say bundle id `dev.viewdeck.app` and the expected version.
 *  4. On quit, a tiny shell script (the one process allowed to outlive the app, see
 *     ChildProcessRegistry.spawnDetachedAfterExit) waits for our PID to exit, swaps the
 *     bundle (restoring the old one if the move fails) and optionally relaunches it.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSha256Sums } from '@shared/update'

export const BUNDLE_ID = 'dev.viewdeck.app'

/** Result of a short-lived tracked command (ditto, codesign, plutil). */
export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface InstallerDeps {
  fetch: typeof fetch
  /** Runs a command through ChildProcessRegistry and collects its output. */
  run: (command: string, args: string[]) => Promise<RunResult>
  /** Starts the post-exit swap helper (untracked on purpose). */
  spawnAfterExit: (command: string, args: string[]) => void
  /** Directory for downloads and the staged bundle (same volume as /Applications, ideally). */
  workDir: string
  pid: number
}

export interface ReleaseAssets {
  version: string
  zipUrl: string
  zipName: string
  sumsUrl: string
}

/** Thrown with a user-facing message; the service turns it into an `error` status. */
export class UpdateError extends Error {}

/**
 * The post-exit swap. Waits for `pid` to exit, moves the old bundle aside, moves the
 * new one in, deletes the old one, or puts the old one back if anything failed.
 * Args: $1 pid, $2 staged app, $3 target app, $4 relaunch (1/0).
 */
export const SWAP_SCRIPT = [
  'pid="$1"; new="$2"; target="$3"; relaunch="$4"',
  'i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done',
  'backup="$target.previous-update"',
  'rm -rf "$backup"',
  'if mv "$target" "$backup" && mv "$new" "$target"; then rm -rf "$backup"; else [ -d "$target" ] || mv "$backup" "$target"; fi',
  '[ "$relaunch" = 1 ] && open "$target"',
  'exit 0'
].join('\n')

export class UpdateInstaller {
  private staged: { version: string; appPath: string } | null = null

  constructor(private readonly deps: InstallerDeps) {}

  get stagedVersion(): string | null {
    return this.staged?.version ?? null
  }

  /** Downloads + verifies + extracts. `onProgress` gets 0–100. Resolves when staged. */
  async prepare(assets: ReleaseAssets, onProgress: (percent: number) => void): Promise<void> {
    const dir = join(this.deps.workDir, assets.version)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })

    const expected = await this.expectedHash(assets)
    const zipPath = join(dir, assets.zipName)
    const actual = await this.download(assets.zipUrl, zipPath, onProgress)
    if (actual !== expected) throw new UpdateError('The downloaded update did not match its published checksum, so it was discarded.')

    const extractDir = join(dir, 'app')
    await mkdir(extractDir)
    await this.mustRun('ditto', ['-x', '-k', zipPath, extractDir], 'Could not unpack the update.')
    const appPath = join(extractDir, 'ViewDeck.app')
    await this.mustRun('codesign', ['--verify', '--deep', '--strict', appPath], 'The update failed its code-signature check, so it was discarded.')
    const plist = join(appPath, 'Contents', 'Info.plist')
    const id = (await this.deps.run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist])).stdout.trim()
    const ver = (await this.deps.run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist])).stdout.trim()
    if (id !== BUNDLE_ID || ver !== assets.version) throw new UpdateError(`The update is not the expected app (got ${id || '?'} ${ver || '?'}).`)
    await rm(zipPath, { force: true })
    this.staged = { version: assets.version, appPath }
  }

  /** Starts the swap helper for `targetApp`. Call right before the app quits. */
  installAfterExit(targetApp: string, relaunch: boolean): boolean {
    if (!this.staged) return false
    this.deps.spawnAfterExit('/bin/sh', ['-c', SWAP_SCRIPT, 'viewdeck-update', String(this.deps.pid), this.staged.appPath, targetApp, relaunch ? '1' : '0'])
    this.staged = null
    return true
  }

  private async expectedHash(assets: ReleaseAssets): Promise<string> {
    const res = await this.deps.fetch(assets.sumsUrl)
    if (!res.ok) throw new UpdateError(`Could not download the release checksums (HTTP ${res.status}).`)
    const hash = parseSha256Sums(await res.text()).get(assets.zipName)
    if (!hash) throw new UpdateError(`The release has no checksum for ${assets.zipName}.`)
    return hash
  }

  private async download(url: string, dest: string, onProgress: (percent: number) => void): Promise<string> {
    const res = await this.deps.fetch(url)
    if (!res.ok || !res.body) throw new UpdateError(`Download failed (HTTP ${res.status}).`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    const out = createWriteStream(dest)
    let received = 0
    let lastPct = -1
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        received += value.length
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        const pct = total ? Math.floor((received / total) * 100) : 0
        if (pct !== lastPct) onProgress((lastPct = pct))
      }
    } finally {
      await new Promise<void>((r) => out.end(r))
    }
    return hash.digest('hex')
  }

  private async mustRun(command: string, args: string[], message: string): Promise<void> {
    const r = await this.deps.run(command, args)
    if (r.code !== 0) throw new UpdateError(`${message} ${r.stderr.trim()}`.trim())
  }
}
