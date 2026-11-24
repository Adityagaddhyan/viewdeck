/**
 * Downloads, verifies and stages an update, and swaps the app bundle after quit.
 *
 * Why not electron-updater / Squirrel.Mac: Squirrel only accepts updates signed by
 * the same Developer ID, and ViewDeck is ad-hoc signed until it has one. So:
 *  1. Download `ViewDeck-<v>-<arch>-mac.zip` from the GitHub Release, hashing as it streams
 *     (aborted if no data arrives for a minute).
 *  2. Compare with the release's SHA256SUMS.txt. Both URLs must be this repo's release
 *     downloads over https.
 *  3. `ditto` extracts it. The archive must hold exactly one real `ViewDeck.app` folder (no
 *     symlink), `codesign --verify --deep --strict` must pass, and the Info.plist must say
 *     bundle id `dev.viewdeck.app` and the expected version.
 *  4. At `will-quit`, SWAP_SCRIPT (the one process allowed to outlive the app, see
 *     ChildProcessRegistry.spawnDetachedAfterExit) waits for our PID to exit, then swaps.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseSha256Sums, RELEASES_REPO } from '@shared/update'

export const BUNDLE_ID = 'dev.viewdeck.app'
/** A stalled download is aborted after this long without data. */
const IDLE_TIMEOUT_MS = 60_000
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/
const RELEASE_URL_PREFIX = `https://github.com/${RELEASES_REPO}/releases/download/`

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
  /** Directory for downloads and the staged bundle. Emptied before each download. */
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
 * The post-exit swap. Args: $1 pid, $2 staged app, $3 target app, $4 relaunch (1/0).
 * - Waits up to 60 s for the app to exit, and does nothing if it is still running (quit cancelled).
 * - Copies the new bundle NEXT TO the target first. A failed copy leaves the old app untouched.
 * - Then two renames in the same folder. If the second fails, the old bundle is put back.
 */
export const SWAP_SCRIPT = [
  'pid="$1"; new="$2"; target="$3"; relaunch="$4"',
  'i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done',
  'kill -0 "$pid" 2>/dev/null && exit 0',
  'next="$target.new-update"; backup="$target.previous-update"',
  'rm -rf "$next" "$backup"',
  'ditto "$new" "$next" || { rm -rf "$next"; exit 1; }',
  'if mv "$target" "$backup"; then',
  '  if mv "$next" "$target"; then rm -rf "$backup" "$new"; else rm -rf "$target"; mv "$backup" "$target"; fi',
  'fi',
  'rm -rf "$next"',
  '[ "$relaunch" = 1 ] && open "$target"',
  'exit 0'
].join('\n')

export class UpdateInstaller {
  private staged: { version: string; appPath: string } | null = null

  constructor(private readonly deps: InstallerDeps) {}

  get stagedVersion(): string | null {
    return this.staged?.version ?? null
  }

  /** Removes leftovers from earlier downloads (call at launch when nothing is staged). */
  async cleanup(): Promise<void> {
    if (!this.staged) await rm(this.deps.workDir, { recursive: true, force: true }).catch(() => {})
  }

  /** Downloads + verifies + extracts. `onProgress` gets 0–100. Resolves when staged. */
  async prepare(assets: ReleaseAssets, onProgress: (percent: number) => void): Promise<void> {
    if (!PLAIN_VERSION.test(assets.version)) throw new UpdateError(`Unexpected release version "${assets.version}".`)
    for (const url of [assets.zipUrl, assets.sumsUrl]) {
      if (!url.startsWith(RELEASE_URL_PREFIX)) throw new UpdateError('The update download does not come from the ViewDeck releases.')
    }
    this.staged = null
    await rm(this.deps.workDir, { recursive: true, force: true })
    const dir = join(this.deps.workDir, assets.version)
    await mkdir(dir, { recursive: true })

    const expected = await this.expectedHash(assets)
    const zipPath = join(dir, assets.zipName)
    const actual = await this.download(assets.zipUrl, zipPath, onProgress)
    if (actual !== expected) throw new UpdateError('The downloaded update did not match its published checksum, so it was discarded.')

    const extractDir = join(dir, 'app')
    await mkdir(extractDir)
    await this.mustRun('ditto', ['-x', '-k', zipPath, extractDir], 'Could not unpack the update.')
    const entries = (await readdir(extractDir)).filter((e) => e !== '__MACOSX')
    const appPath = join(extractDir, 'ViewDeck.app')
    const st = await lstat(appPath).catch(() => null)
    if (entries.length !== 1 || entries[0] !== 'ViewDeck.app' || !st?.isDirectory() || st.isSymbolicLink()) {
      throw new UpdateError('The update archive has unexpected contents, so it was discarded.')
    }
    await this.mustRun('codesign', ['--verify', '--deep', '--strict', appPath], 'The update failed its code-signature check, so it was discarded.')
    const plist = join(appPath, 'Contents', 'Info.plist')
    const id = (await this.deps.run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist])).stdout.trim()
    const ver = (await this.deps.run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist])).stdout.trim()
    if (id !== BUNDLE_ID || ver !== assets.version) throw new UpdateError(`The update is not the expected app (got ${id || '?'} ${ver || '?'}).`)
    await rm(zipPath, { force: true })
    this.staged = { version: assets.version, appPath }
  }

  /** Starts the swap helper for `targetApp` (once). Call from `will-quit`. */
  installAfterExit(targetApp: string, relaunch: boolean): boolean {
    if (!this.staged) return false
    this.deps.spawnAfterExit('/bin/sh', ['-c', SWAP_SCRIPT, 'viewdeck-update', String(this.deps.pid), this.staged.appPath, targetApp, relaunch ? '1' : '0'])
    this.staged = null
    return true
  }

  private async expectedHash(assets: ReleaseAssets): Promise<string> {
    const res = await this.deps.fetch(assets.sumsUrl, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new UpdateError(`Could not download the release checksums (HTTP ${res.status}).`)
    const hash = parseSha256Sums(await res.text()).get(assets.zipName)
    if (!hash) throw new UpdateError(`The release has no checksum for ${assets.zipName}.`)
    return hash
  }

  private async download(url: string, dest: string, onProgress: (percent: number) => void): Promise<string> {
    const abort = new AbortController()
    let idle: ReturnType<typeof setTimeout> | undefined
    const kick = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => abort.abort(), IDLE_TIMEOUT_MS)
    }
    kick()
    try {
      const res = await this.deps.fetch(url, { signal: abort.signal })
      if (!res.ok || !res.body) throw new UpdateError(`Download failed (HTTP ${res.status}).`)
      if (res.url && !res.url.startsWith('https://')) throw new UpdateError('The download was redirected to an insecure address.')
      const total = Number(res.headers.get('content-length')) || 0
      const hash = createHash('sha256')
      let received = 0
      let lastPct = -1
      const tap = new Transform({
        transform(chunk: Buffer, _enc, done) {
          kick()
          hash.update(chunk)
          received += chunk.length
          const pct = total ? Math.min(100, Math.floor((received / total) * 100)) : 0
          if (pct !== lastPct) onProgress((lastPct = pct))
          done(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), tap, createWriteStream(dest))
      return hash.digest('hex')
    } catch (err) {
      if (err instanceof UpdateError) throw err
      if (abort.signal.aborted) throw new UpdateError('The download stalled and was stopped. Try again.')
      throw new UpdateError(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      clearTimeout(idle)
    }
  }

  private async mustRun(command: string, args: string[], message: string): Promise<void> {
    const r = await this.deps.run(command, args)
    if (r.code !== 0) throw new UpdateError(`${message} ${r.stderr.trim()}`.trim())
  }
}
