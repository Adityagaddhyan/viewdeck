/**
 * Update checking: types shared by main and renderer, plus the pure helpers the
 * checker and installer rely on (version comparison, release asset choice,
 * SHA256SUMS parsing). No Node / DOM / Electron imports.
 *
 * Releases are GitHub Releases of the public repo; each carries
 * `ViewDeck-<v>-<arch>-mac.zip` per CPU and a `SHA256SUMS.txt` (see release.yml).
 */

/** Public repo the app checks for releases. */
export const RELEASES_REPO = 'Adityagaddhyan/viewdeck'
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`

/** A newer release, as the renderer needs it. */
export interface UpdateRelease {
  version: string
  /** Release page (notes + manual downloads). */
  url: string
  /** Release notes (Markdown), trimmed for display. */
  notes: string
  publishedAt: string
}

/**
 * Update lifecycle, pushed to the renderer on every change (`update:status`).
 * - `available`: a newer release exists; `canInstall` says whether one-click update works here
 *   (packaged app in a writable location), otherwise the UI offers the download page.
 * - `downloading` → `ready`: downloaded, checksum + signature verified, waiting for restart.
 *   A ready update is also installed when the app quits normally.
 */
export type UpdateStatus =
  | { state: 'idle'; current: string; checkedAt: string | null }
  | { state: 'checking'; current: string }
  | { state: 'available'; current: string; release: UpdateRelease; canInstall: boolean; reason?: string }
  | { state: 'downloading'; current: string; release: UpdateRelease; percent: number }
  | { state: 'ready'; current: string; release: UpdateRelease }
  | { state: 'error'; current: string; message: string; release?: UpdateRelease }

/** Parses `v1.2.3` / `1.2.3`. Pre-release and build suffixes are ignored; null if not x.y.z. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when `latest` is a strictly higher x.y.z than `current`. Unparseable → false. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return false
}

/** electron-builder's arch name for the running CPU (`process.arch`). */
export const builderArch = (nodeArch: string): 'arm64' | 'x64' | null => (nodeArch === 'arm64' ? 'arm64' : nodeArch === 'x64' ? 'x64' : null)

/** File name of the macOS zip for a version and arch (matches electron-builder.yml). */
export const zipAssetName = (version: string, arch: 'arm64' | 'x64'): string => `ViewDeck-${version}-${arch}-mac.zip`

/** Parses `shasum -a 256` output into file name → lower-case hex digest. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m) out.set(m[2]!, m[1]!.toLowerCase())
  }
  return out
}
