/**
 * Discovers AWS profiles from the user's shared config files and manages SSO login.
 *
 * Reads files only. It never writes to ~/.aws: the AWS CLI owns those files and
 * the SSO token cache (ADR-002).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { AwsProfile, AwsProfileKind, SsoStatus } from '@shared/types/aws'
import { AppErrorException } from '../ipc/toAppError'
import type { ChildProcessRegistry } from '../process/ChildProcessRegistry'
import { cliEnv, findExecutable } from './cliPath'
import { parseIni, type IniSections } from './iniParser'
import { readSsoTokenState } from './ssoTokenCache'
import { awsCliMissingError } from './remediation'

export interface AwsProfileServiceDeps {
  registry: ChildProcessRegistry
  env?: NodeJS.ProcessEnv
  homeDir?: string
  /** Returns file contents, or null if the file does not exist. */
  readFile?: (path: string) => string | null
  now?: () => Date
  /** Resolves the `aws` binary. Defaults to augmented-PATH lookup. */
  findAwsCli?: () => string | null
}

/** Upper bound on how long we wait for the user to finish the browser SSO flow. */
const SSO_LOGIN_TIMEOUT_MS = 10 * 60 * 1000

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export class AwsProfileService {
  private readonly env: NodeJS.ProcessEnv
  private readonly home: string
  private readonly readFile: (path: string) => string | null
  private readonly now: () => Date
  private readonly findAwsCli: () => string | null
  private readonly logins = new Map<string, ChildProcess>()

  constructor(private readonly deps: AwsProfileServiceDeps) {
    this.env = deps.env ?? process.env
    this.home = deps.homeDir ?? homedir()
    this.readFile = deps.readFile ?? defaultReadFile
    this.now = deps.now ?? (() => new Date())
    this.findAwsCli = deps.findAwsCli ?? (() => findExecutable('aws'))
  }

  /** Honours AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE like the CLI and SDK do. */
  private get configPath(): string {
    return this.env['AWS_CONFIG_FILE'] ?? join(this.home, '.aws', 'config')
  }
  private get credentialsPath(): string {
    return this.env['AWS_SHARED_CREDENTIALS_FILE'] ?? join(this.home, '.aws', 'credentials')
  }

  private loadConfig(): IniSections {
    return parseIni(this.readFile(this.configPath) ?? '')
  }

  /** All profiles across both files, `default` first and the rest alphabetical. */
  listProfiles(): AwsProfile[] {
    const config = this.loadConfig()
    const creds = parseIni(this.readFile(this.credentialsPath) ?? '')
    const profiles = new Map<string, { cfg: Record<string, string>; sources: AwsProfile['sources'] }>()

    for (const [section, values] of config) {
      // In the config file, profiles are `[default]` or `[profile name]`.
      // `[sso-session x]` and `[services x]` are not profiles.
      const name = section === 'default' ? 'default' : /^profile\s+(.+)$/.exec(section)?.[1]?.trim()
      if (!name) continue
      profiles.set(name, { cfg: { ...values }, sources: ['config'] })
    }
    for (const [name, values] of creds) {
      const existing = profiles.get(name)
      if (existing) {
        existing.cfg = { ...values, ...existing.cfg }
        existing.sources.push('credentials')
      } else {
        profiles.set(name, { cfg: { ...values }, sources: ['credentials'] })
      }
    }

    return [...profiles.entries()]
      .map(([name, { cfg, sources }]) => toProfile(name, cfg, sources, config))
      .sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)))
  }

  /** Local-only SSO token check. Use it to decide whether to offer "Sign in with AWS SSO". */
  getSsoStatus(profileName: string): SsoStatus {
    const profile = this.listProfiles().find((p) => p.name === profileName)
    if (!profile) {
      throw new AppErrorException({ code: 'NOT_FOUND', message: `AWS profile "${profileName}" not found` })
    }
    if (profile.kind !== 'sso') return { profile: profileName, state: 'not-sso', expiresAt: null }

    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl
    if (!cacheKey) return { profile: profileName, state: 'missing', expiresAt: null }
    const { state, expiresAt } = readSsoTokenState({
      cacheDir: join(this.home, '.aws', 'sso', 'cache'),
      cacheKey,
      readFile: this.readFile,
      now: this.now()
    })
    return { profile: profileName, state, expiresAt }
  }

  /**
   * Runs `aws sso login --profile <name>`. The CLI opens the browser itself. Resolves
   * with the refreshed status after the CLI exits successfully. A login already
   * running for the same profile is reused.
   */
  async ssoLogin(profileName: string): Promise<SsoStatus> {
    const awsCli = this.findAwsCli()
    if (!awsCli) {
      throw new AppErrorException(awsCliMissingError('The AWS CLI (v2) is needed to sign in with AWS SSO.'))
    }

    const child =
      this.logins.get(profileName) ??
      this.deps.registry.spawn(awsCli, ['sso', 'login', '--profile', profileName], {
        env: cliEnv({ env: this.env }),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    this.logins.set(profileName, child)

    try {
      await waitForExit(child, SSO_LOGIN_TIMEOUT_MS)
    } finally {
      this.logins.delete(profileName)
    }
    return this.getSsoStatus(profileName)
  }

  /** Kills an in-flight login (user closed the wizard or pressed Cancel). */
  async cancelSsoLogin(profileName: string): Promise<void> {
    const child = this.logins.get(profileName)
    if (child) await this.deps.registry.kill(child)
  }
}

function toProfile(
  name: string,
  cfg: Record<string, string>,
  sources: AwsProfile['sources'],
  config: IniSections
): AwsProfile {
  const ssoSession = cfg['sso_session'] ?? null
  const session = ssoSession ? config.get(`sso-session ${ssoSession}`) : undefined
  let kind: AwsProfileKind = 'other'
  if (ssoSession || cfg['sso_start_url']) kind = 'sso'
  else if (cfg['role_arn']) kind = 'assume-role'
  else if (cfg['credential_process']) kind = 'process'
  else if (cfg['aws_access_key_id']) kind = 'static'

  return {
    name,
    kind,
    region: cfg['region'] ?? null,
    ssoSession,
    ssoStartUrl: session?.['sso_start_url'] ?? cfg['sso_start_url'] ?? null,
    ssoAccountId: cfg['sso_account_id'] ?? null,
    ssoRoleName: cfg['sso_role_name'] ?? null,
    sourceProfile: cfg['source_profile'] ?? null,
    sources
  }
}

/** Resolves on exit code 0. Rejects with a categorised AppError otherwise. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new AppErrorException({ code: 'AWS_SSO_EXPIRED', message: 'AWS SSO login timed out.', hint: 'Start the sign-in again and finish it in the browser within 10 minutes.' }))
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(new AppErrorException({ code: 'AWS_CLI_MISSING', message: `Could not run the AWS CLI: ${err.message}` }))
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      reject(
        new AppErrorException({
          code: 'AWS_SSO_EXPIRED',
          message: signal ? 'AWS SSO login was cancelled.' : `aws sso login failed (exit ${code ?? '?'}).`,
          detail: stderr.trim() || undefined
        })
      )
    })
  })
}
