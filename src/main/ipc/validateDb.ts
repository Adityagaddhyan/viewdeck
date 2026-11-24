/**
 * Runtime validation for database-related IPC payloads (renderer input is
 * untrusted). The driver binds values and quotes identifiers anyway. These
 * checks reject malformed shapes early, with clear messages.
 */
import type { SaveConnectionRequest } from '@shared/types/connection'
import type { CellValue, StagedChange, StagedChangeset } from '@shared/types/driver'
import { DriverFactory } from '../drivers/DriverFactory'
import { AppErrorException } from './toAppError'
import { requirePort, requireString } from './validate'

const invalid = (message: string): never => {
  throw new AppErrorException({ code: 'VALIDATION', message })
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isCellValue(v: unknown): v is CellValue {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
}

function requireCellRecord(v: unknown, field: string): Record<string, CellValue> {
  if (!isObject(v)) return invalid(`${field} must be an object`)
  for (const [k, val] of Object.entries(v)) {
    if (k.length === 0 || k.length > 256) invalid(`${field} has an invalid column name`)
    if (!isCellValue(val)) invalid(`${field}.${k} must be a string, number, boolean or null`)
  }
  return v as Record<string, CellValue>
}

export function requireParams(v: unknown): CellValue[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || !v.every(isCellValue)) return invalid('params must be an array of cell values')
  return v
}

export function requireChangeset(v: unknown): StagedChangeset {
  if (!isObject(v)) return invalid('changeset must be an object')
  const schema = requireString(v['schema'], 'changeset.schema')
  const table = requireString(v['table'], 'changeset.table')
  const raw = v['changes']
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10_000) {
    return invalid('changeset.changes must be a non-empty array (max 10,000)')
  }
  const changes = raw.map((c: unknown, i): StagedChange => {
    if (!isObject(c)) return invalid(`changes[${i}] must be an object`)
    switch (c['kind']) {
      case 'update':
        return { kind: 'update', key: requireCellRecord(c['key'], `changes[${i}].key`), values: requireCellRecord(c['values'], `changes[${i}].values`) }
      case 'insert':
        return { kind: 'insert', values: requireCellRecord(c['values'], `changes[${i}].values`) }
      case 'delete':
        return { kind: 'delete', key: requireCellRecord(c['key'], `changes[${i}].key`) }
      default:
        return invalid(`changes[${i}].kind must be update, insert or delete`)
    }
  })
  return { schema, table, changes }
}

const HOST = /^[A-Za-z0-9.\-:[\]]+$/
const TLS_MODES = new Set(['disable', 'require', 'verify-full'])
const ENVS = new Set(['prod', 'staging', 'dev', 'unknown'])

/** Validates connections:save / db:testConnection input. Returns it typed. */
export function requireConnectionInput(req: unknown): SaveConnectionRequest {
  if (!isObject(req) || !isObject(req['connection'])) return invalid('connection is required')
  const c = req['connection']
  requireString(c['name'], 'name')
  if (!DriverFactory.engines().includes(c['engine'] as never)) invalid('unsupported engine')
  requireString(c['database'], 'database')
  if (!TLS_MODES.has(c['tlsMode'] as string)) invalid('tlsMode is invalid')
  if (c['environment'] !== null && !ENVS.has(c['environment'] as string)) invalid('environment is invalid')

  const route = c['route']
  if (!isObject(route)) return invalid('route is required')
  if (route['kind'] === 'direct') {
    requireString(route['host'], 'route.host', HOST)
    requirePort(route['port'])
  } else if (route['kind'] === 'ssm-tunnel') {
    requireString(route['targetInstanceId'], 'route.targetInstanceId', /^(i|mi)-[0-9a-f]+$/)
    requireString(route['rdsHost'], 'route.rdsHost', HOST)
    requirePort(route['rdsPort'])
  } else invalid('route.kind must be direct or ssm-tunnel')

  const auth = c['auth']
  if (!isObject(auth) || (auth['kind'] !== 'password' && auth['kind'] !== 'rds-iam')) return invalid('auth is invalid')
  requireString(auth['user'], 'auth.user')

  const aws = c['aws']
  if (aws !== null) {
    if (!isObject(aws)) return invalid('aws is invalid')
    requireString(aws['profile'], 'aws.profile')
    requireString(aws['region'], 'aws.region', /^[a-z]{2}(-[a-z]+)+-\d+$/)
  }
  if (req['password'] !== undefined && typeof req['password'] !== 'string') invalid('password must be a string')
  return req as unknown as SaveConnectionRequest
}
