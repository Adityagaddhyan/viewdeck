import { describe, expect, it } from 'vitest'
import { augmentedPath, findExecutable } from './cliPath'

describe('cliPath', () => {
  it('appends Homebrew and plugin dirs to a minimal Finder PATH', () => {
    const p = augmentedPath({ env: { PATH: '/usr/bin:/bin' }, platform: 'darwin' })
    expect(p.split(':')).toEqual(
      expect.arrayContaining(['/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/sessionmanagerplugin/bin'])
    )
    expect(p.split(':').filter((d) => d === '/usr/bin')).toHaveLength(1)
  })

  it('finds an executable outside the inherited PATH', () => {
    const found = findExecutable('session-manager-plugin', {
      env: { PATH: '/usr/bin' },
      platform: 'darwin',
      isExecutable: (p) => p === '/usr/local/sessionmanagerplugin/bin/session-manager-plugin'
    })
    expect(found).toBe('/usr/local/sessionmanagerplugin/bin/session-manager-plugin')
  })

  it('returns null when missing', () => {
    expect(findExecutable('aws', { env: { PATH: '' }, platform: 'darwin', isExecutable: () => false })).toBeNull()
  })
})
