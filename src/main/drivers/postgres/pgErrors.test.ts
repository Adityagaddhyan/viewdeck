import { describe, expect, it } from 'vitest'
import { AppErrorException } from '../../ipc/toAppError'
import { toPgAppError } from './pgErrors'

const ctx = { iam: true, user: 'app_ro', host: 'db.x.rds.amazonaws.com' }

describe('toPgAppError', () => {
  it('IAM auth failure gives a checklist, GRANT command and docs link', () => {
    const e = toPgAppError(Object.assign(new Error('PAM authentication failed for user "app_ro"'), { code: '28000' }), ctx)
    expect(e.code).toBe('DB_AUTH_FAILED')
    expect(e.steps?.length).toBeGreaterThanOrEqual(4)
    expect(e.command).toBe('GRANT rds_iam TO "app_ro";')
    expect(e.docsUrl).toMatch(/IAMDBAuth/)
  })
  it('password auth failure stays simple', () => {
    const e = toPgAppError(Object.assign(new Error('password authentication failed'), { code: '28P01' }), { ...ctx, iam: false })
    expect(e).toMatchObject({ code: 'DB_AUTH_FAILED', hint: 'Check the username and password.' })
    expect(e.steps).toBeUndefined()
  })
  it('passes AppErrors from the IAM token provider through (e.g. SSO expired mid-session)', () => {
    const sso = new AppErrorException({ code: 'AWS_SSO_EXPIRED', message: 'expired', context: { profile: 'p' } })
    expect(toPgAppError(sso, ctx)).toMatchObject({ code: 'AWS_SSO_EXPIRED', context: { profile: 'p' } })
  })
  it('carries the SQL error position for editor underlining', () => {
    const e = toPgAppError(Object.assign(new Error('relation "ordrs" does not exist'), { code: '42P01', position: '15' }), ctx)
    expect(e.context).toEqual({ position: 15 })
  })

  it.each([
    ['25006', 'DB_READ_ONLY'],
    ['ECONNREFUSED', 'DB_CONNECTION_FAILED'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'DB_CONNECTION_FAILED'],
    ['42P01', 'DB_QUERY_FAILED']
  ])('%s → %s', (code, out) => {
    expect(toPgAppError(Object.assign(new Error('x'), { code }), ctx).code).toBe(out)
  })
})
