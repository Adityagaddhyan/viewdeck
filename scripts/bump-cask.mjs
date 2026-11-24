// Updates the Homebrew cask in a local checkout of the homebrew-tap repo to a
// published GitHub release: reads the release's SHA256SUMS.txt and rewrites the
// `version` line and the arm/intel `sha256` values in Casks/viewdeck.rb. No git.
//
// Usage: node scripts/bump-cask.mjs <version> <path-to-tap-checkout>
// e.g.   node scripts/bump-cask.mjs 0.2.0 ../homebrew-tap
// Env:   VIEWDECK_SUMS_URL overrides the SHA256SUMS.txt URL (file:// paths work, for tests).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'Adityagaddhyan/viewdeck'

/** Parses `shasum -a 256` output and returns the arm64 and x64 zip checksums. */
export function pickZipSums(sumsText, version) {
  const sums = new Map()
  for (const line of sumsText.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/i)
    if (m) sums.set(m[2], m[1].toLowerCase())
  }
  const want = (arch) => {
    const name = `ViewDeck-${version}-${arch}-mac.zip`
    const sum = sums.get(name)
    if (!sum) throw new Error(`SHA256SUMS.txt has no entry for ${name}`)
    return sum
  }
  return { arm: want('arm64'), intel: want('x64') }
}

/** Returns the cask text with the version and both sha256 values replaced. */
export function rewriteCask(cask, version, { arm, intel }) {
  const replace = (text, re, value, what) => {
    if (!re.test(text)) throw new Error(`Could not find the ${what} in the cask`)
    return text.replace(re, value)
  }
  let out = replace(cask, /^(\s*version\s+)"[^"]*"/m, `$1"${version}"`, 'version line')
  out = replace(out, /(sha256\s+arm:\s*)"[0-9a-f]*"/, `$1"${arm}"`, 'sha256 arm value')
  out = replace(out, /(intel:\s*)"[0-9a-f]*"/, `$1"${intel}"`, 'sha256 intel value')
  return out
}

async function fetchText(url) {
  if (url.startsWith('file://')) return readFile(fileURLToPath(url), 'utf8')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`)
  return res.text()
}

async function main() {
  const [rawVersion, tapDir] = process.argv.slice(2)
  if (!rawVersion || !tapDir) {
    console.error('Usage: node scripts/bump-cask.mjs <version> ../homebrew-tap')
    process.exit(2)
  }
  const version = rawVersion.replace(/^v/, '')
  const sumsUrl = process.env.VIEWDECK_SUMS_URL ??
    `https://github.com/${REPO}/releases/download/v${version}/SHA256SUMS.txt`
  const caskPath = join(tapDir, 'Casks', 'viewdeck.rb')
  const sums = pickZipSums(await fetchText(sumsUrl), version)
  const before = await readFile(caskPath, 'utf8')
  const after = rewriteCask(before, version, sums)
  await writeFile(caskPath, after)
  console.log(`Updated ${caskPath}`)
  console.log(`  version  ${version}`)
  console.log(`  arm64    ${sums.arm}`)
  console.log(`  x64      ${sums.intel}`)
  if (before === after) console.log('  (no changes: cask was already up to date)')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`bump-cask: ${err.message}`)
    process.exit(1)
  })
}
