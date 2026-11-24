/**
 * Tracks every child process ViewDeck spawns (SSM tunnels, `aws sso login`) and
 * guarantees none outlive the app (AGENTS.md invariant 9).
 *
 * Why process groups: `aws ssm start-session` is a Python wrapper that spawns
 * `session-manager-plugin` as its own child. Killing only the `aws` PID can
 * orphan the plugin, which keeps holding the local port. So on POSIX we spawn
 * with `detached: true`, which makes the child a process-group leader, and
 * signal the whole group with `process.kill(-pid)`. On Windows we use
 * `taskkill /T /F`, which kills the tree.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** Grace period between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 3000

export class ChildProcessRegistry {
  private readonly children = new Set<ChildProcess>()

  constructor(
    private readonly spawnFn: SpawnFn = nodeSpawn,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  /** Spawns a tracked child. It is untracked automatically when it exits. */
  spawn(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
    const child = this.spawnFn(command, args, {
      ...options,
      detached: this.platform !== 'win32',
      windowsHide: true
    })
    this.children.add(child)
    const untrack = (): void => {
      this.children.delete(child)
    }
    child.once('exit', untrack)
    child.once('error', untrack)
    return child
  }

  /**
   * Terminates a child and its descendants. Sends SIGTERM first and escalates to
   * SIGKILL if the child is still alive after the grace period. Resolves on exit.
   */
  kill(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      this.children.delete(child)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.signalTree(child, 'SIGKILL'), KILL_GRACE_MS)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.signalTree(child, 'SIGTERM')
    })
  }

  /**
   * Synchronous best-effort kill of everything. Safe to call from `will-quit`
   * or `process.on('exit')`, where async work never completes.
   */
  killAllSync(): void {
    for (const child of this.children) this.signalTree(child, 'SIGKILL')
    this.children.clear()
  }

  get size(): number {
    return this.children.size
  }

  private signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid
    if (pid === undefined) return
    try {
      if (this.platform === 'win32') {
        nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      } else {
        process.kill(-pid, signal)
      }
    } catch {
      // The group may already be gone (ESRCH). Fall back to the direct child.
      try {
        child.kill(signal)
      } catch {
        /* already dead */
      }
    }
  }
}
