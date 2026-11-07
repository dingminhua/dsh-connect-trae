import { describe, it, expect, vi } from 'vitest'
import { createAutoCheckin, foldCheckin, checkinDay, type AutoCheckinState } from '../src/auto-checkin.ts'
const now = new Date(2026, 10, 7, 12).getTime()
const empty = (): AutoCheckinState => ({day: checkinDay(now), done: [], deviceBlocked: false, failures: 0, retryAt: 0})
describe('automatic check-in', () => {
  it('defaults to no work when disabled and stops on disposal', async () => {
    const run = vi.fn(async () => [])
    const runner = createAutoCheckin({enabled: () => false, read: async () => undefined, write: async () => {}, run})
    await runner.tick(); runner.stop(); await runner.tick()
    expect(run).not.toHaveBeenCalled()
  })
  it('retains account progress but stops at the device reward limit', () => {
    const result = foldCheckin(empty(), [{accountId:'a',accountName:'A',status:'claimed'}, {accountId:'b',accountName:'B',status:'device-already'}], now)
    expect(result.done).toEqual(['a']); expect(result.deviceBlocked).toBe(true)
  })
  it('resumes saved progress and retries failures with backoff', async () => {
    let time = now
    const saved = {...empty(), done: ['a']}
    const run = vi.fn(async () => [{accountId:'b',accountName:'B',status:'failed' as const}])
    const write = vi.fn(async () => {})
    const runner = createAutoCheckin({enabled: () => true, read: async () => saved, write, run, now: () => time})
    await runner.tick(); await runner.tick()
    expect(run).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledWith(['a'])
    time += 60_000; await runner.tick(); expect(run).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledTimes(2)
  })
  it('does not repeat completed device work until the date changes', async () => {
    let time = now
    const run = vi.fn(async () => [])
    const runner = createAutoCheckin({enabled: () => true, read: async () => ({...empty(),deviceBlocked:true}), write: async () => {},run,now: () => time})
    await runner.tick(); expect(run).not.toHaveBeenCalled()
    time += 86400_000; await runner.tick(); expect(run).toHaveBeenCalledTimes(1)
  })
  it('serializes overlapping timer callbacks', async () => {
    let finish!: () => void
    const run = vi.fn(async () => { await new Promise<void>(resolve => {finish=resolve}); return [] })
    const runner = createAutoCheckin({enabled: () => true, read: async () => undefined, write: async () => {},run,now: () => now})
    const first = runner.tick(); await Promise.resolve(); await runner.tick()
    finish(); await first; expect(run).toHaveBeenCalledTimes(1)
  })
})
