import { describe, expect, it } from 'vitest'
import { toAwsAppError } from './awsErrors'

const err = (name: string, message: string): Error => Object.assign(new Error(message), { name })

describe('toAwsAppError', () => {
  it.each([
    [err('CredentialsProviderError', 'The SSO session associated with this profile has expired or is otherwise invalid.'), 'AWS_SSO_EXPIRED'],
    [err('UnauthorizedException', 'Session token not found or invalid'), 'AWS_SSO_EXPIRED'],
    [err('ExpiredTokenException', 'The security token included in the request is expired'), 'AWS_SSO_EXPIRED'],
    [err('AccessDenied', 'User is not authorized to perform: rds:DescribeDBInstances'), 'AWS_ACCESS_DENIED'],
    [err('UnauthorizedOperation', 'You are not authorized to perform this operation.'), 'AWS_ACCESS_DENIED'],
    [err('CredentialsProviderError', 'Could not load credentials from any providers'), 'AWS_CREDENTIALS_MISSING'],
    [err('Error', 'connect ECONNREFUSED 127.0.0.1:9'), 'AWS_NETWORK_ERROR'],
    [err('Error', 'getaddrinfo ENOTFOUND sts.us-east-1.amazonaws.com'), 'AWS_NETWORK_ERROR'],
    [err('ThrottlingException', 'Rate exceeded'), 'UNKNOWN']
  ])('%s → %s', (e, code) => {
    expect(toAwsAppError(e, 'p').code).toBe(code)
  })

  it('includes a runnable command and profile context for SSO', () => {
    const e = toAwsAppError(err('X', 'Token is expired'), 'acme-prod')
    expect(e.command).toBe('aws sso login --profile acme-prod')
    expect(e.context).toEqual({ profile: 'acme-prod' })
  })
})
