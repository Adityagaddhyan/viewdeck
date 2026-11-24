import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeChild } from '../testing/fakeChild'
import { ChildProcessRegistry } from './ChildProcessRegistry'

afterEach(() => vi.restoreAllMocks())

describe('ChildProcessRegistry', () => {
  it('spawns detached on POSIX (own process group) and untracks on exit', () => {
    const child = createFakeChild()
    const spawn = vi.fn(() => child)
    const reg = new ChildProcessRegistry(spawn, 'darwin')
    reg.spawn('aws', ['x'])
    expect(spawn).toHaveBeenCalledWith('aws', ['x'], expect.objectContaining({ detached: true }))
    expect(reg.size).toBe(1)
    child.finish(0)
    expect(reg.size).toBe(0)
  })

  it('killAllSync SIGKILLs every process group', () => {
    const a = createFakeChild()
    const b = createFakeChild()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const reg = new ChildProcessRegistry(vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b), 'linux')
    reg.spawn('x', [])
    reg.spawn('y', [])
    reg.killAllSync()
    expect(kill).toHaveBeenCalledWith(-(a.pid as number), 'SIGKILL')
    expect(kill).toHaveBeenCalledWith(-(b.pid as number), 'SIGKILL')
    expect(reg.size).toBe(0)
  })

  it('kill() escalates to SIGKILL after the grace period', async () => {
    vi.useFakeTimers()
    const child = createFakeChild()
    const signals: string[] = []
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, sig: string) => {
      signals.push(sig)
      if (sig === 'SIGKILL') child.finish(null, 'SIGKILL')
      return true
    }) as typeof process.kill)
    const reg = new ChildProcessRegistry(vi.fn(() => child), 'darwin')
    reg.spawn('x', [])
    const done = reg.kill(child)
    await vi.advanceTimersByTimeAsync(3000)
    await done
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    vi.useRealTimers()
  })
})
