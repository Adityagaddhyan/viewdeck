/**
 * Reads the AWS CLI's SSO token cache (~/.aws/sso/cache/<sha1>.json).
 *
 * The file name is SHA-1(hex) of the `sso_session` name for modern
 * `[sso-session]` configs, or of the start URL for legacy inline SSO profiles.
 * This mirrors botocore and the JS SDK's `getSSOTokenFilepath`.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SsoTokenState } from '@shared/types/aws'

interface CachedToken {
  accessToken?: string
  expiresAt?: string
  refreshToken?: string
  registrationExpiresAt?: string
}

export interface ReadSsoTokenOptions {
  cacheDir: string
  cacheKey: string
  readFile: (path: string) => string | null
  now: Date
}

/** Older CLIs wrote `2019-11-14T04:05:45UTC`. Normalise that to ISO-8601 `Z`. */
function parseExpiry(value: string | undefined): Date | null {
  if (!value) return null
  const d = new Date(value.replace(/UTC$/, 'Z'))
  return Number.isNaN(d.getTime()) ? null : d
}

export function ssoCacheFileName(cacheKey: string): string {
  return `${createHash('sha1').update(cacheKey).digest('hex')}.json`
}

/**
 * `valid` also covers an expired access token that the SDK can silently refresh:
 * modern sso-session configs store a refresh token, and the SDK uses it while the
 * client registration is unexpired. Prompting for a browser login in that case
 * would be needless friction.
 */
export function readSsoTokenState(opts: ReadSsoTokenOptions): {
  state: SsoTokenState
  expiresAt: string | null
} {
  const raw = opts.readFile(join(opts.cacheDir, ssoCacheFileName(opts.cacheKey)))
  if (!raw) return { state: 'missing', expiresAt: null }

  let token: CachedToken
  try {
    token = JSON.parse(raw) as CachedToken
  } catch {
    return { state: 'missing', expiresAt: null }
  }
  const expiresAt = parseExpiry(token.expiresAt)
  if (!token.accessToken || !expiresAt) return { state: 'missing', expiresAt: null }
  if (expiresAt > opts.now) return { state: 'valid', expiresAt: expiresAt.toISOString() }

  const registrationExpiry = parseExpiry(token.registrationExpiresAt)
  if (token.refreshToken && registrationExpiry && registrationExpiry > opts.now) {
    return { state: 'valid', expiresAt: expiresAt.toISOString() }
  }
  return { state: 'expired', expiresAt: expiresAt.toISOString() }
}
