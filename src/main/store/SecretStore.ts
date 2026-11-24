/**
 * Encrypted secret storage (database passwords).
 *
 * Secrets are encrypted with Electron `safeStorage`: the macOS Keychain, DPAPI
 * on Windows, or libsecret/kwallet on Linux. Only ciphertext reaches SQLite.
 * If OS encryption is unavailable (e.g. Linux with no keyring, where
 * safeStorage falls back to a hardcoded key), we REFUSE to store rather than
 * silently writing a weakly protected secret (AGENTS.md invariant 6).
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { AppErrorException } from '../ipc/toAppError'

/** The slice of Electron's `safeStorage` we use (injected for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: 'basic_text' means no real keyring. */
  getSelectedStorageBackend?(): string
}

export class SecretStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly safeStorage: SafeStorageLike
  ) {}

  private assertAvailable(): void {
    const backend = this.safeStorage.getSelectedStorageBackend?.()
    if (!this.safeStorage.isEncryptionAvailable() || backend === 'basic_text') {
      throw new AppErrorException({
        code: 'VALIDATION',
        message: 'OS secure storage is unavailable, so ViewDeck will not save passwords.',
        hint: 'On Linux, install and unlock a keyring (gnome-keyring or kwallet). Or use RDS IAM auth, which needs no stored password.'
      })
    }
  }

  /** Encrypts and stores a secret. Pass `ref` to overwrite an existing one. Returns the ref. */
  put(plain: string, ref: string = `secret:${randomUUID()}`): string {
    this.assertAvailable()
    const ciphertext = this.safeStorage.encryptString(plain)
    this.db
      .prepare(
        `INSERT INTO secrets (ref, ciphertext, created_at) VALUES (?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET ciphertext = excluded.ciphertext`
      )
      .run(ref, ciphertext, new Date().toISOString())
    return ref
  }

  get(ref: string): string {
    const row = this.db.prepare('SELECT ciphertext FROM secrets WHERE ref = ?').get(ref) as
      | { ciphertext: Uint8Array }
      | undefined
    if (!row) throw new AppErrorException({ code: 'NOT_FOUND', message: 'Saved password not found.', hint: 'Edit the connection and enter the password again.' })
    this.assertAvailable()
    return this.safeStorage.decryptString(Buffer.from(row.ciphertext))
  }

  delete(ref: string): void {
    this.db.prepare('DELETE FROM secrets WHERE ref = ?').run(ref)
  }
}
