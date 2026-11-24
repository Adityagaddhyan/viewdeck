/**
 * Maps AWS SDK and credential-provider errors to actionable AppErrors.
 *
 * Message matching is unavoidable here: credential-provider failures are all a
 * generic `CredentialsProviderError`, and only the message says *why* (expired
 * SSO session vs. missing profile). Keep these patterns loose and test-covered.
 */
import type { AppError } from '@shared/types/result'
import { AppErrorException } from '../ipc/toAppError'

const SSO_EXPIRED = [
  /sso session .*(expired|invalid)/i,
  /token is expired/i,
  /refresh .*sso/i,
  /sso.*token.*(expired|not found|missing)/i,
  /ExpiredToken/i,
  /UnauthorizedException/ // sso:GetRoleCredentials with a stale access token
]
const ACCESS_DENIED = /AccessDenied|UnauthorizedOperation|not authorized to perform|AuthorizationError/i
const NETWORK = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|socket hang up|TimeoutError|NetworkingError|getaddrinfo/i
const NO_CREDENTIALS = /could not load credentials|profile .* (could not be found|not found)|unable to load|no valid credential/i

function describe(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message }
  return { name: 'Error', message: String(err) }
}

/** Converts any error from an AWS call into an AppError. AppErrorExceptions pass through. */
export function toAwsAppError(err: unknown, profile: string): AppError {
  if (err instanceof AppErrorException) return err.appError
  const { name, message } = describe(err)
  const text = `${name}: ${message}`

  if (SSO_EXPIRED.some((re) => re.test(text))) {
    return {
      code: 'AWS_SSO_EXPIRED',
      message: `The AWS SSO session for "${profile}" has expired.`,
      hint: 'Sign in again to refresh it. Your browser opens to complete the login.',
      command: `aws sso login --profile ${profile}`,
      context: { profile },
      detail: text
    }
  }
  if (ACCESS_DENIED.test(text)) {
    return {
      code: 'AWS_ACCESS_DENIED',
      message: `Profile "${profile}" is not allowed to perform this action.`,
      hint: 'The IAM role behind this profile is missing a permission ViewDeck needs.',
      steps: [
        'Discovery needs rds:DescribeDBInstances and rds:DescribeDBClusters.',
        'VPC tunnels need ec2:DescribeInstances, ssm:DescribeInstanceInformation and ssm:StartSession (on the instance and the AWS-StartPortForwardingSessionToRemoteHost document).',
        'IAM database auth needs rds-db:connect on arn:aws:rds-db:<region>:<account>:dbuser:<DbiResourceId>/<db user>.',
        'Check the raw error under Details for the exact action that was denied.'
      ],
      context: { profile },
      detail: text
    }
  }
  if (NO_CREDENTIALS.test(text)) {
    return {
      code: 'AWS_CREDENTIALS_MISSING',
      message: `No usable credentials for AWS profile "${profile}".`,
      hint: 'Check the profile in ~/.aws/config, or set up SSO for it.',
      command: 'aws configure sso',
      context: { profile },
      detail: text
    }
  }
  if (NETWORK.test(text)) {
    return {
      code: 'AWS_NETWORK_ERROR',
      message: "Can't reach AWS.",
      hint: 'The request never got a response from AWS.',
      steps: [
        'Check your internet connection or VPN.',
        'If you use a proxy, make sure HTTPS_PROXY is set in the environment ViewDeck starts from.',
        'Check that the region is correct.'
      ],
      context: { profile },
      detail: text
    }
  }
  return { code: 'UNKNOWN', message, detail: text }
}

/** Runs an AWS call and rethrows failures as categorised AppErrorExceptions. */
export async function withAwsErrors<T>(profile: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw new AppErrorException(toAwsAppError(err, profile))
  }
}
