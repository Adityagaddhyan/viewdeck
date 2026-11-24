import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { ChildProcessRegistry } from '../process/ChildProcessRegistry'
import { createFakeChild } from '../testing/fakeChild'
import { AwsProfileService } from './AwsProfileService'
import { ssoCacheFileName } from './ssoTokenCache'

const HOME = '/home/u'
const CONFIG = `
[default]
region = us-east-1

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = us-east-1

[profile acme-prod]
sso_session = acme
sso_account_id = 111111111111
sso_role_name = ReadOnly
region = eu-west-1

[profile legacy-sso]
sso_start_url = https://legacy.awsapps.com/start
sso_account_id = 222
sso_role_name = Admin

[profile chained]
role_arn = arn:aws:iam::333:role/x
source_profile = default

[sso-session not-a-profile]
sso_start_url = https://x
`
const CREDS = `
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = secret

[ci]
aws_access_key_id = AKIA2
`
const NOW = new Date('2026-11-23T12:00:00Z')
const cachePath = (key: string): string => join(HOME, '.aws', 'sso', 'cache', ssoCacheFileName(key))

function service(files: Record<string, string> = {}, registry = new ChildProcessRegistry(vi.fn())) {
  const base: Record<string, string> = {
    [join(HOME, '.aws', 'config')]: CONFIG,
    [join(HOME, '.aws', 'credentials')]: CREDS
  }
  return new AwsProfileService({
    registry,
    env: {},
    homeDir: HOME,
    readFile: (p) => files[p] ?? base[p] ?? null,
    now: () => NOW,
    findAwsCli: () => '/opt/homebrew/bin/aws'
  })
}

describe('AwsProfileService.listProfiles', () => {
  it('merges config + credentials, classifies kinds, skips sso-session sections', () => {
    const profiles = service().listProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'acme-prod', 'chained', 'ci', 'legacy-sso'])
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]))
    expect(byName['default']).toMatchObject({ kind: 'static', region: 'us-east-1', sources: ['config', 'credentials'] })
    expect(byName['acme-prod']).toMatchObject({
      kind: 'sso',
      ssoSession: 'acme',
      ssoStartUrl: 'https://acme.awsapps.com/start',
      ssoAccountId: '111111111111',
      region: 'eu-west-1'
    })
    expect(byName['legacy-sso']).toMatchObject({ kind: 'sso', ssoSession: null })
    expect(byName['chained']).toMatchObject({ kind: 'assume-role', sourceProfile: 'default' })
    expect(byName['ci']).toMatchObject({ kind: 'static', sources: ['credentials'] })
  })

  it('returns [] when ~/.aws does not exist', () => {
    const s = new AwsProfileService({ registry: new ChildProcessRegistry(vi.fn()), env: {}, homeDir: HOME, readFile: () => null })
    expect(s.listProfiles()).toEqual([])
  })
})

describe('AwsProfileService.getSsoStatus', () => {
  it('not-sso for static profiles', () => {
    expect(service().getSsoStatus('default').state).toBe('not-sso')
  })

  it('missing when there is no cache file', () => {
    expect(service().getSsoStatus('acme-prod').state).toBe('missing')
  })

  it('valid when the token is unexpired (keyed by session name)', () => {
    const s = service({ [cachePath('acme')]: JSON.stringify({ accessToken: 't', expiresAt: '2026-11-23T20:00:00Z' }) })
    expect(s.getSsoStatus('acme-prod')).toEqual({
      profile: 'acme-prod',
      state: 'valid',
      expiresAt: '2026-11-23T20:00:00.000Z'
    })
  })

  it('expired for legacy profiles keyed by start URL, including the old UTC format', () => {
    const s = service({
      [cachePath('https://legacy.awsapps.com/start')]: JSON.stringify({ accessToken: 't', expiresAt: '2026-11-23T08:00:00UTC' })
    })
    expect(s.getSsoStatus('legacy-sso').state).toBe('expired')
  })

  it('valid when the access token expired but a refresh token is usable', () => {
    const s = service({
      [cachePath('acme')]: JSON.stringify({
        accessToken: 't',
        expiresAt: '2026-11-23T08:00:00Z',
        refreshToken: 'r',
        registrationExpiresAt: '2027-01-01T00:00:00Z'
      })
    })
    expect(s.getSsoStatus('acme-prod').state).toBe('valid')
  })

  it('throws NOT_FOUND for unknown profiles', () => {
    expect(() => service().getSsoStatus('nope')).toThrow(/not found/)
  })
})

describe('AwsProfileService.ssoLogin', () => {
  it('spawns aws sso login and resolves with refreshed status on exit 0', async () => {
    const child = createFakeChild()
    const spawn = vi.fn(() => child)
    const files: Record<string, string> = {}
    const s = service(files, new ChildProcessRegistry(spawn, 'darwin'))
    const done = s.ssoLogin('acme-prod')
    expect(spawn).toHaveBeenCalledWith(
      '/opt/homebrew/bin/aws',
      ['sso', 'login', '--profile', 'acme-prod'],
      expect.objectContaining({ detached: true })
    )
    files[cachePath('acme')] = JSON.stringify({ accessToken: 't', expiresAt: '2026-11-24T00:00:00Z' })
    child.finish(0)
    await expect(done).resolves.toMatchObject({ state: 'valid' })
  })

  it('rejects with AWS_SSO_EXPIRED and stderr detail on failure', async () => {
    const child = createFakeChild()
    const s = service({}, new ChildProcessRegistry(vi.fn(() => child), 'darwin'))
    const done = s.ssoLogin('acme-prod')
    child.emitStderr('Error when retrieving token from sso')
    await new Promise((r) => setImmediate(r))
    child.finish(255)
    await expect(done).rejects.toMatchObject({
      appError: { code: 'AWS_SSO_EXPIRED', detail: 'Error when retrieving token from sso' }
    })
  })

  it('AWS_CLI_MISSING when aws is not installed', async () => {
    const s = new AwsProfileService({
      registry: new ChildProcessRegistry(vi.fn()),
      env: {},
      homeDir: HOME,
      readFile: () => CONFIG,
      findAwsCli: () => null
    })
    await expect(s.ssoLogin('acme-prod')).rejects.toMatchObject({ appError: { code: 'AWS_CLI_MISSING' } })
  })
})
