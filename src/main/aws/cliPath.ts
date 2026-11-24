/**
 * Locates the `aws` CLI and `session-manager-plugin`.
 *
 * Why: a macOS app launched from Finder or the Dock inherits launchd's minimal
 * PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), not the user's shell PATH. Homebrew and
 * the official installers put these tools elsewhere, so we append the well-known
 * install directories. The augmented PATH is also passed to the spawned `aws`
 * process, because `aws ssm start-session` looks up `session-manager-plugin` on PATH.
 */
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

const EXTRA_DIRS_POSIX = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/local/aws-cli',
  '/usr/local/sessionmanagerplugin/bin',
  '/usr/bin'
]
const EXTRA_DIRS_WIN = [
  'C:\\Program Files\\Amazon\\AWSCLIV2',
  'C:\\Program Files\\Amazon\\SessionManagerPlugin\\bin'
]

export interface CliEnvOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Injected for tests. Returns true if `path` is an executable file. */
  isExecutable?: (path: string) => boolean
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** PATH with the well-known AWS tool directories appended (deduplicated, order kept). */
export function augmentedPath(opts: CliEnvOptions = {}): string {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const sep = platform === 'win32' ? ';' : delimiter
  const current = (env['PATH'] ?? env['Path'] ?? '').split(sep).filter(Boolean)
  const extra = platform === 'win32' ? EXTRA_DIRS_WIN : EXTRA_DIRS_POSIX
  return [...new Set([...current, ...extra])].join(sep)
}

/** Environment for spawning AWS CLI children: the user's env plus the augmented PATH. */
export function cliEnv(opts: CliEnvOptions = {}): NodeJS.ProcessEnv {
  const env = opts.env ?? process.env
  // Keep output machine-friendly and never block on a pager or a prompt.
  return { ...env, PATH: augmentedPath(opts), AWS_PAGER: '' }
}

/** Absolute path of `name` on the augmented PATH, or null if it is not installed. */
export function findExecutable(name: string, opts: CliEnvOptions = {}): string | null {
  const platform = opts.platform ?? process.platform
  const isExec = opts.isExecutable ?? defaultIsExecutable
  const sep = platform === 'win32' ? ';' : delimiter
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of augmentedPath(opts).split(sep)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (isExec(candidate)) return candidate
    }
  }
  return null
}

export interface CliTools {
  awsCli: string | null
  sessionManagerPlugin: string | null
}

export function detectCliTools(opts: CliEnvOptions = {}): CliTools {
  return {
    awsCli: findExecutable('aws', opts),
    sessionManagerPlugin: findExecutable('session-manager-plugin', opts)
  }
}
