/**
 * Checks GitHub Releases for a newer ViewDeck and drives the update lifecycle
 * (idle → checking → available → downloading → ready, or error). Every change is
 * pushed to the renderer as `update:status`.
 *
 * Network: one unauthenticated GET to api.github.com when checking (at launch and
 * every 12 h, only if Settings → "Check for updates" is on), plus the release
 * download when the user clicks Update. Nothing about the user is sent; the
 * User-Agent is a fixed "ViewDeck/<version>".
 */
import { access, constants } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  builderArch,
  isNewer,
  RELEASES_PAGE,
  RELEASES_REPO,
  zipAssetName,
  type UpdateRelease,
  type UpdateStatus
} from '@shared/update'
import { UpdateError, type ReleaseAssets, type UpdateInstaller } from './UpdateInstaller'

const CHECK_EVERY_MS = 12 * 3_600_000
const FIRST_CHECK_DELAY_MS = 15_000

export interface UpdateServiceDeps {
  fetch: typeof fetch
  installer: UpdateInstaller
  currentVersion: string
  /** `process.arch`. */
  arch: string
  /** Path of the running `.app` bundle, or null in dev / non-macOS. */
  appBundle: string | null
  /** Whether automatic checks are on (Settings), read at each scheduled check. */
  autoCheckEnabled: () => boolean
  onStatus: (status: UpdateStatus) => void
  /** True in e2e runs: never touch the network on a timer. */
  disableTimers?: boolean
}

interface GithubAsset {
  name: string
  browser_download_url: string
}
interface GithubRelease {
  tag_name: string
  html_url: string
  body: string | null
  published_at: string
  draft: boolean
  prerelease: boolean
  assets: GithubAsset[]
}

export class UpdateService {
  private status: UpdateStatus
  private assets: ReleaseAssets | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private relaunch = false
  private inFlight: Promise<UpdateStatus> | null = null

  constructor(private readonly deps: UpdateServiceDeps) {
    this.status = { state: 'idle', current: deps.currentVersion, checkedAt: null }
  }

  get current(): UpdateStatus {
    return this.status
  }

  /** Schedules the first check shortly after launch, then every 12 hours. */
  start(): void {
    if (this.deps.disableTimers || this.timer) return
    void this.deps.installer.cleanup() // leftovers from earlier downloads
    const tick = (): void => {
      if (this.deps.autoCheckEnabled() && (this.status.state === 'idle' || this.status.state === 'error')) void this.check()
    }
    setTimeout(tick, FIRST_CHECK_DELAY_MS).unref?.()
    this.timer = setInterval(tick, CHECK_EVERY_MS)
    this.timer.unref?.()
  }

  /**
   * Asks GitHub for the latest release. Never throws; the outcome is the returned status.
   * Concurrent calls share one request. A failed re-check keeps an already-found update.
   */
  check(): Promise<UpdateStatus> {
    if (this.status.state === 'downloading' || this.status.state === 'ready') return Promise.resolve(this.status)
    this.inFlight ??= this.doCheck().finally(() => (this.inFlight = null))
    return this.inFlight
  }

  private async doCheck(): Promise<UpdateStatus> {
    const previous = this.status
    const current = this.deps.currentVersion
    this.set({ state: 'checking', current })
    try {
      const res = await this.deps.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ViewDeck/${current}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15_000)
      })
      if (res.status === 404) return this.set({ state: 'idle', current, checkedAt: new Date().toISOString() })
      if (!res.ok) throw new UpdateError(`GitHub answered HTTP ${res.status}.`)
      const rel = (await res.json()) as GithubRelease
      const version = rel.tag_name.replace(/^v/, '')
      // Only plain x.y.z: the version ends up in file paths and asset names.
      if (rel.draft || rel.prerelease || !/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, current)) {
        return this.set({ state: 'idle', current, checkedAt: new Date().toISOString() })
      }
      const release: UpdateRelease = { version, url: rel.html_url || RELEASES_PAGE, notes: (rel.body ?? '').slice(0, 4000), publishedAt: rel.published_at }
      this.assets = this.pickAssets(rel, version)
      const blocker = await this.installBlocker()
      return this.set({ state: 'available', current, release, canInstall: !blocker, ...(blocker ? { reason: blocker } : {}) })
    } catch (err) {
      if (previous.state === 'available') return this.set(previous)
      return this.set({ state: 'error', current, message: `Couldn't check for updates: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  /** Downloads and stages the available update. Resolves with the final status. */
  async download(): Promise<UpdateStatus> {
    const s = this.status
    if (s.state !== 'available' || !s.canInstall || !this.assets) return this.status
    const { release, current } = s
    this.set({ state: 'downloading', current, release, percent: 0 })
    try {
      await this.deps.installer.prepare(this.assets, (percent) => this.set({ state: 'downloading', current, release, percent }))
      return this.set({ state: 'ready', current, release })
    } catch (err) {
      const message = err instanceof UpdateError ? err.message : `The update failed: ${err instanceof Error ? err.message : String(err)}`
      return this.set({ state: 'error', current, message, release })
    }
  }

  /** "Restart now": the next quit relaunches the new version (the caller then quits the app). */
  requestRestart(): boolean {
    if (this.status.state !== 'ready') return false
    this.relaunch = true
    return true
  }

  /**
   * Starts the post-exit swap if an update is staged (once). Call from `will-quit`, which a
   * window can't cancel, so the app really is exiting. After
   * "Restart now" the new version relaunches; otherwise it is simply there next launch.
   */
  installOnQuit(): boolean {
    if (this.status.state !== 'ready' || !this.deps.appBundle) return false
    return this.deps.installer.installAfterExit(this.deps.appBundle, this.relaunch)
  }

  private pickAssets(rel: GithubRelease, version: string): ReleaseAssets | null {
    const arch = builderArch(this.deps.arch)
    if (!arch) return null
    const zipName = zipAssetName(version, arch)
    const zip = rel.assets.find((a) => a.name === zipName)
    const sums = rel.assets.find((a) => a.name === 'SHA256SUMS.txt')
    return zip && sums ? { version, zipName, zipUrl: zip.browser_download_url, sumsUrl: sums.browser_download_url } : null
  }

  /** Why one-click install can't work here (the UI then offers the download page), or null. */
  private async installBlocker(): Promise<string | null> {
    const app = this.deps.appBundle
    if (!app) return 'This build updates through the downloads page.'
    if (!this.assets) return 'This release has no automatic-update package for your Mac.'
    if (app.includes('/AppTranslocation/') || app.startsWith('/Volumes/')) {
      return 'Move ViewDeck to your Applications folder to enable one-click updates.'
    }
    try {
      await access(dirname(app), constants.W_OK)
      await access(app, constants.W_OK)
    } catch {
      return "ViewDeck's folder isn't writable by your user, so download the update instead."
    }
    return null
  }

  private set(next: UpdateStatus): UpdateStatus {
    this.status = next
    this.deps.onStatus(next)
    return next
  }
}
