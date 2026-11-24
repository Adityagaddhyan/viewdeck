/**
 * Dependencies injected into drivers by DriverFactory. Drivers never reach into
 * AWS, safeStorage or the filesystem directly, which keeps them unit-testable
 * and keeps the AWS layer out of the driver contract.
 */
import type { DriverAuth } from '@shared/types/driver'

export interface DriverDeps {
  /** Decrypts a stored password by secretRef (SecretStore). */
  resolvePassword(secretRef: string): Promise<string>
  /**
   * Returns a per-connection IAM token provider (RdsIamSignerService). The pool
   * must call it for EVERY new physical connection (ADR-002).
   */
  iamPasswordProvider(auth: Extract<DriverAuth, { kind: 'rds-iam' }>): () => Promise<string>
  /** PEM text of the AWS RDS global CA bundle (resources/rds-global-bundle.pem). */
  rdsCaBundle(): string
}
