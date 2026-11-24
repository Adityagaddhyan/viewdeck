/**
 * Per-pool pg type parsers that keep results grid-friendly and IPC-safe.
 *
 * Postgres sends results as text. pg's default parsers turn some of that text
 * into JS objects that are wrong for a DB GUI: timestamps become `Date`
 * (timezone-shifted, microseconds lost), bytea becomes `Buffer`, arrays and
 * json become objects, and int8/numeric would lose precision as numbers.
 *
 * We keep Postgres's own text for everything except types that are exactly
 * representable in JS: bool, int2, int4, oid, float4, float8. So int8/numeric
 * stay exact strings, timestamps show exactly what the server sent, and bytea
 * shows as `\x…` hex. Every value is a CellValue, which IPC can clone.
 */
import type { CustomTypesConfig } from 'pg'

const BOOL = 16
const INT2 = 21
const INT4 = 23
const OID = 26
const FLOAT4 = 700
const FLOAT8 = 701

const identity = (v: string): string => v

export function parseTextValue(oid: number, value: string): string | number | boolean {
  switch (oid) {
    case BOOL:
      return value === 't' || value === 'true'
    case INT2:
    case INT4:
    case OID:
      return Number.parseInt(value, 10)
    case FLOAT4:
    case FLOAT8: {
      // 'Infinity', '-Infinity' and 'NaN' are valid float text. Keep them as strings.
      const n = Number(value)
      return Number.isFinite(n) ? n : value
    }
    default:
      return value
  }
}

export const gridTypes: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => {
    if (format === 'binary') return identity
    return (value: string) => parseTextValue(oid, value)
  }) as CustomTypesConfig['getTypeParser']
}
