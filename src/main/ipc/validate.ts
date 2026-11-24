/**
 * Runtime validation for IPC requests. The renderer is untrusted (AGENTS.md
 * invariant 1), so TypeScript types alone are not a guarantee. Values that reach
 * child-process arguments get pattern checks too. We never use a shell, but a
 * value like `--profile` could still be mistaken for a CLI flag.
 */
import { AppErrorException } from './toAppError'

export function requireString(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new AppErrorException({ code: 'VALIDATION', message: `"${field}" must be a non-empty string` })
  }
  if (value.startsWith('-') || (pattern && !pattern.test(value))) {
    throw new AppErrorException({ code: 'VALIDATION', message: `"${field}" has an invalid format` })
  }
  return value
}

export function requirePort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppErrorException({ code: 'VALIDATION', message: 'port must be an integer between 1 and 65535' })
  }
  return value
}
