import { describe, expect, it } from 'vitest'
import { parseIni } from './iniParser'

describe('parseIni', () => {
  it('parses sections, comments and nested blocks', () => {
    const ini = parseIni(`
# comment
[default]
region = us-east-1
s3 =
  max_concurrent_requests = 10
output=json

; another
[profile acme-prod]
SSO_Session = acme
`)
    expect(ini.get('default')).toEqual({ region: 'us-east-1', s3: '', output: 'json' })
    expect(ini.get('profile acme-prod')).toEqual({ sso_session: 'acme' })
  })

  it('merges repeated sections', () => {
    const ini = parseIni('[a]\nx=1\n[a]\ny=2\n')
    expect(ini.get('a')).toEqual({ x: '1', y: '2' })
  })
})
