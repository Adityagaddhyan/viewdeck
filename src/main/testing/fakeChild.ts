/**
 * Test helper: a fake ChildProcess driven by the test (emit stdout, exit...).
 * Lives under src/main/testing and is imported only from *.test.ts files.
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'

export interface FakeChild extends ChildProcess {
  emitStdout(text: string): void
  emitStderr(text: string): void
  finish(code: number | null, signal?: NodeJS.Signals | null): void
}

let nextPid = 40000

export function createFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(ee, {
    pid: nextPid++,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: (signal: NodeJS.Signals = 'SIGTERM') => {
      ee.finish(null, signal)
      return true
    },
    emitStdout: (t: string) => stdout.write(t),
    emitStderr: (t: string) => stderr.write(t),
    finish: (code: number | null, signal: NodeJS.Signals | null = null) => {
      if (ee.exitCode !== null || ee.signalCode !== null) return
      Object.assign(ee, { exitCode: code, signalCode: signal })
      ee.emit('exit', code, signal)
    }
  })
  return ee
}
