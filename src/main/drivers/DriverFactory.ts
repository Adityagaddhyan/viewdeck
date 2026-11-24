/**
 * Creates DatabaseDriver instances by engine id.
 *
 * Adding an engine: implement DatabaseDriver in drivers/<engine>/ and add one
 * line to REGISTRY. `Record<DatabaseEngine, …>` makes the compiler reject a new
 * engine id that has no registered driver. See docs/ADDING_A_DATABASE.md.
 */
import type { DatabaseDriver, DatabaseEngine } from '@shared/types/driver'
import { PostgresDriver } from './postgres/PostgresDriver'
import type { DriverDeps } from './types'

const REGISTRY: Record<DatabaseEngine, (deps: DriverDeps) => DatabaseDriver> = {
  postgres: (deps) => new PostgresDriver(deps)
}

export class DriverFactory {
  constructor(private readonly deps: DriverDeps) {}

  /** A new, unconnected driver. Each session owns its own instance. */
  create(engine: DatabaseEngine): DatabaseDriver {
    const make = REGISTRY[engine]
    if (!make) throw new Error(`No driver registered for engine "${engine}"`)
    return make(this.deps)
  }

  static engines(): DatabaseEngine[] {
    return Object.keys(REGISTRY) as DatabaseEngine[]
  }
}
