/**
 * Locates bundled static resources (e.g. the RDS CA bundle).
 *
 * Dev: `<repo>/resources/<name>`. Packaged: `process.resourcesPath/<name>`, so
 * the packager must copy `resources/` as extraResources.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

let rdsCa: string | null = null

/** AWS RDS global CA bundle (all regions, RSA + ECC roots). Read once and cached. */
export function rdsCaBundle(): string {
  rdsCa ??= readFileSync(resourcePath('rds-global-bundle.pem'), 'utf8')
  return rdsCa
}
