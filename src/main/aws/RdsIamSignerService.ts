/**
 * Generates RDS IAM authentication tokens.
 *
 * A token is a SigV4-presigned `connect` URL, valid for 15 minutes and checked
 * by RDS only during the connection handshake. So:
 *
 *   - NEVER cache a token as a static pool password (AGENTS.md invariant 7).
 *     Hand `pg.Pool` the function from `createPasswordProvider()`. pg calls it
 *     for every new physical connection, and each call signs a fresh token.
 *   - Established connections are unaffected by token expiry.
 *
 * Signing is local CPU work (no network) once credentials are resolved, and
 * credentials are memoised per profile by AwsClientFactory. That makes a fresh
 * token per connection cheap.
 *
 * Important: `hostname` and `port` must be the REAL RDS endpoint, even when
 * the socket goes through a 127.0.0.1 SSM tunnel. RDS validates the signature
 * against its own endpoint.
 */
import { Signer } from '@aws-sdk/rds-signer'
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types'
import { withAwsErrors } from './awsErrors'

export interface IamTokenParams {
  profile: string
  region: string
  /** Real RDS endpoint hostname (not 127.0.0.1). */
  hostname: string
  /** Real RDS port (not the local tunnel port). */
  port: number
  username: string
}

export interface TokenSigner {
  getAuthToken(): Promise<string>
}

export type SignerFactory = (
  params: IamTokenParams & { credentials: AwsCredentialIdentityProvider }
) => TokenSigner

const defaultSignerFactory: SignerFactory = ({ region, hostname, port, username, credentials }) =>
  new Signer({ region, hostname, port, username, credentials })

export class RdsIamSignerService {
  constructor(
    private readonly credentials: (profile: string) => AwsCredentialIdentityProvider,
    private readonly signerFactory: SignerFactory = defaultSignerFactory
  ) {}

  /** Signs a single token. Prefer createPasswordProvider() for pools. */
  async getAuthToken(params: IamTokenParams): Promise<string> {
    return this.createPasswordProvider(params)()
  }

  /**
   * Returns `() => Promise<token>` for `pg.Pool({ password })`. Each invocation
   * signs a new token, so connections opened hours after `connect()` still
   * authenticate. Errors map to AppErrors (e.g. AWS_SSO_EXPIRED).
   */
  createPasswordProvider(params: IamTokenParams): () => Promise<string> {
    if (/^(127\.0\.0\.1|localhost|::1)$/i.test(params.hostname)) {
      // Signing for localhost produces a token RDS will always reject. This is
      // a programming error in the tunnel wiring, so fail loudly.
      throw new Error('RDS IAM tokens must be signed for the real RDS endpoint, not the local tunnel address')
    }
    const signer = this.signerFactory({ ...params, credentials: this.credentials(params.profile) })
    return () => withAwsErrors(params.profile, () => signer.getAuthToken())
  }
}
