import { describe, expect, it } from 'vitest'
import { READ_WRITE_ESCAPE } from './readOnly'

describe('READ_WRITE_ESCAPE', () => {
  it.each([
    'SET default_transaction_read_only = off',
    'set session default_transaction_read_only to off',
    'RESET default_transaction_read_only',
    'SET transaction_read_only = off',
    "select set_config('default_transaction_read_only', 'off', false)",
    'BEGIN READ WRITE',
    'START TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE'
  ])('blocks: %s', (sql) => {
    expect(READ_WRITE_ESCAPE.test(sql)).toBe(true)
  })

  it.each([
    'SHOW default_transaction_read_only',
    "SELECT current_setting('default_transaction_read_only')",
    'SELECT * FROM orders',
    "SET search_path = 'app'",
    'BEGIN'
  ])('allows: %s', (sql) => {
    expect(READ_WRITE_ESCAPE.test(sql)).toBe(false)
  })
})
