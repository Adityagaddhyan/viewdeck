import { describe, expect, it } from 'vitest'
import { parseTextValue } from './typeParsers'

describe('parseTextValue', () => {
  it.each([
    [16, 't', true],
    [16, 'f', false],
    [23, '42', 42],
    [20, '9007199254740993', '9007199254740993'], // int8 stays exact
    [1700, '12345678901234567890.123', '12345678901234567890.123'],
    [701, '1.5', 1.5],
    [701, 'NaN', 'NaN'],
    [1184, '2026-11-23 12:00:00.123456+00', '2026-11-23 12:00:00.123456+00'],
    [17, '\\xdeadbeef', '\\xdeadbeef'],
    [3802, '{"a": 1}', '{"a": 1}']
  ] as const)('oid %i %s', (oid, input, out) => {
    expect(parseTextValue(oid, input)).toBe(out)
  })
})
