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
  it('treats a per-account device refusal as that account being done, not the machine', () => {
    // Shared-device mode: `device-already` means the MACHINE spent its slot.
    // Per-account mode: it means THIS ACCOUNT's own derived id was already used,
    // so the account is finished for today and the machine is not blocked.
    const result = foldCheckin(empty(), [{accountId:'a',accountName:'A',status:'claimed'}, {accountId:'b',accountName:'B',status:'device-already'}], now, {perAccountDevice: true})
    expect(result.done).toEqual(['a', 'b']); expect(result.deviceBlocked).toBe(false)
  })
  it('resumes saved progress and retries failures with backoff', async () => {
    let time = now
    const saved = {...empty(), done: ['a']}
    const run = vi.fn(async () => [{accountId:'b',accountName:'B',status:'failed' as const}])
    const write = vi.fn(async () => {})
    const runner = createAutoCheckin({enabled: () => true, read: async () => saved, write, run, now: () => time, random: () => 0})
    await runner.tick(); await runner.tick()
    // The second argument is the day's failed-batch count, which salts the retry
    // device id: a second round must not re-send ids `9074` already refused.
    expect(run).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledWith(['a'], 0)
    time += 60_000; await runner.tick(); expect(run).toHaveBeenCalledTimes(2)
    // The first batch reported a failure, so this round is 1.
    expect(run).toHaveBeenLastCalledWith(['a'], 1)
    expect(write).toHaveBeenCalledTimes(2)
  })
  it('does not repeat completed device work until the date changes', async () => {
    let time = now
    const run = vi.fn(async () => [])
    const runner = createAutoCheckin({enabled: () => true, read: async () => ({...empty(),deviceBlocked:true}), write: async () => {},run,now: () => time, random: () => 0})
    await runner.tick(); expect(run).not.toHaveBeenCalled()
    time += 86400_000; await runner.tick(); expect(run).toHaveBeenCalledTimes(1)
  })
  it('serializes overlapping timer callbacks', async () => {
    let finish!: () => void
    const run = vi.fn(async () => { await new Promise<void>(resolve => {finish=resolve}); return [] })
    const runner = createAutoCheckin({enabled: () => true, read: async () => undefined, write: async () => {},run,now: () => now, random: () => 0})
    const first = runner.tick(); await Promise.resolve(); await runner.tick()
    finish(); await first; expect(run).toHaveBeenCalledTimes(1)
  })

  it('stages the first attempt of a fresh day instead of firing at midnight', async () => {
    // Measured 2026-11-26: the 00:00:00 shot is the one 9074 refuses most often,
    // and every install fires at that same instant. A fresh day therefore waits a
    // bounded random gap, and the staged deadline is persisted so a restart does
    // not re-roll it (and so the panel can show when the next attempt will be).
    let time = now
    const run = vi.fn(async () => [])
    const write = vi.fn(async () => {})
    const runner = createAutoCheckin({enabled: () => true, read: async () => undefined, write, run, now: () => time, random: () => 0.5})
    await runner.tick()
    expect(run).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledTimes(1)
    const staged = (write.mock.calls[0] as unknown[])[0] as AutoCheckinState
    expect(staged.retryAt).toBeGreaterThan(time)
    time = staged.retryAt
    await runner.tick()
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not stage an attempt when the gap is zero', async () => {
    // `random: () => 0` must stay byte for byte on the old path: no extra write,
    // no delay. Every existing install that has no random source behaves so.
    const run = vi.fn(async () => [])
    const write = vi.fn(async () => {})
    const runner = createAutoCheckin({enabled: () => true, read: async () => undefined, write, run, now: () => now, random: () => 0})
    await runner.tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('spreads retry deadlines apart, so two installs do not retry on the same second', () => {
    const failed = [{accountId:'a',accountName:'A',status:'failed' as const}]
    const at = (random: number) => foldCheckin(empty(), failed, now, {random: () => random}).retryAt
    expect(at(0)).toBe(now + 60_000)
    expect(at(0.99)).toBeGreaterThan(at(0))
    // The jitter must never shorten the wait into a hot loop.
    expect(at(0)).toBeGreaterThanOrEqual(now + 30_000)
  })
})
