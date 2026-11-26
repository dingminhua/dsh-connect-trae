/** 国内个人账号的后台签到，复用手动签到流程及设备限制。 */
import type { TraePoolCheckinRow } from './account-pool-run.ts'

/**
 * 新的一天首次尝试最多往后错开的毫秒数（0～该值之间随机）。
 *
 * 上游在每天零点那一分钟最挤：所有装了本插件的机器都在 00:00:00 那一刻发同一个
 * 请求，于是 `9074`「当前参与用户太多」几乎必然命中，而**同一个设备号被 9074 拒
 * 过之后当天基本不再放行**（2026-11-26 实测：同号连打 20 次 ×5s 全 9074，换一个
 * 新号立刻成功）。错开窗口既不给上游加压力，也让每台机器的首发落在人群之外。
 */
export const FIRST_ATTEMPT_SPREAD_MS = 20 * 60_000

/**
 * 退避时长上额外叠加的随机比例（0～该比例，乘在当前步长上）。
 *
 * 没有抖动时，所有撞过 `9074` 的机器会在同一秒一起重试，把拥挤原样复现一遍。
 * 只加不减：抖动永远不把等待缩短，因此不会把退避变成热循环。
 */
export const RETRY_SPREAD_RATIO = 0.2

export interface AutoCheckinState {
  day: string
  done: string[]
  deviceBlocked: boolean
  failures: number
  retryAt: number
}

/** 按运行机器的本地日期组织进度；领取资格始终以服务器响应为准。 */
export function checkinDay(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 把一批签到结果折进当天进度。
 *
 * `deviceBlocked` 的语义取决于设备号是否按账号派生（`pool.perAccountCheckinDevice`）：
 *
 * - 共用整机设备号（默认）：`9095`/`claimed` 说明「这台机器今天的名额用完了」，
 *   于是置 `deviceBlocked`，当天不再跑 —— 再跑只会重复撞同一面墙。
 * - 按账号派生（opt-in）：`9095` 只说明「这个账号自己的名额用完了」，于是把它记进
 *   `done`（当天不再重试这个账号），但**不**封锁整机，其余账号照常签。
 */
export function foldCheckin(
  state: AutoCheckinState,
  rows: readonly TraePoolCheckinRow[],
  now: number,
  options: { perAccountDevice?: boolean; random?: (() => number) | undefined } = {},
): AutoCheckinState {
  const done = new Set(state.done)
  for (const row of rows) if (row.status === 'already' || row.status === 'claimed') done.add(row.accountId)
  const perAccount = options.perAccountDevice === true
  if (perAccount) for (const row of rows) if (row.status === 'device-already') done.add(row.accountId)
  const failures = rows.some(row => row.status === 'failed') ? state.failures + 1 : 0
  const spent = perAccount
    ? state.deviceBlocked
    : state.deviceBlocked || rows.some(row => row.status === 'device-already' || row.status === 'claimed')
  const step = rows.some(row => row.status === 'disabled') && failures === 0
    ? 30 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** Math.min(failures, 6))
  const random = options.random ?? Math.random
  const spread = Math.round(step * RETRY_SPREAD_RATIO * spreadUnit(random))
  return { day: state.day, done: [...done],
    deviceBlocked: spent,
    failures, retryAt: now + step + spread }
}

/** A random source is allowed to be anything; the spread only ever needs 0～1. */
function spreadUnit(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export interface AutoCheckinDeps {
  enabled(): boolean
  read(): Promise<AutoCheckinState | undefined>
  write(state: AutoCheckinState): Promise<void>
  /**
   * Run one batch. `round` is the day's count of ALREADY FAILED batches
   * (`state.failures`), handed out so a retry can derive a device id upstream has
   * not refused yet: `9074` refuses an id for the rest of the day (issue #103), so
   * a retry that repeats a round's ids was never going to help. Round 0 is the
   * day's first attempt and behaves byte-identically to before rounds existed.
   */
  run(done: readonly string[], round: number): Promise<readonly TraePoolCheckinRow[]>
  now?(): number
  /** 设备号是否按账号派生（`pool.perAccountCheckinDevice`），决定 `9095` 的语义。 */
  perAccountDevice?(): boolean
  /**
   * 随机源，注入以便测试固定首发错开窗口与退避抖动。缺省用 `Math.random`。
   *
   * 返回 0 时行为与本改动之前完全一致：不错开首发，退避步长也不变。
   */
  random?(): number
}

/** 单实例内串行执行。关闭开关或卸载后不再启动新批次。 */
export function createAutoCheckin(deps: AutoCheckinDeps): { tick(): Promise<void>; stop(): void } {
  let running = false
  let stopped = false
  let memory: AutoCheckinState | undefined
  return {
    stop() { stopped = true },
    async tick() {
      if (stopped || running || !deps.enabled()) return
      running = true
      try {
        const now = deps.now?.() ?? Date.now()
        const day = checkinDay(now)
        const stored = memory ?? await deps.read()
        const state = stored?.day === day ? stored : { day, done: [], deviceBlocked: false, failures: 0, retryAt: 0 }
        memory = state
        if (stopped || !deps.enabled() || state.deviceBlocked) return
        if (state.retryAt === 0) {
          // 新的一天还没排过队：先把首发错开，再把窗口写下来。写下来是这件事的
          // 一半 —— 重启后读到同一个窗口，不会重新掷一次骰子；面板也就能直接
          // 显示「下次尝试时间」。
          const staged = stageFirstAttempt(state, now, deps.random)
          if (staged !== state) {
            memory = staged
            await deps.write(memory)
            return
          }
        }
        if (now < state.retryAt) return
        let rows: readonly TraePoolCheckinRow[]
        try { rows = await deps.run(state.done, state.failures) }
        catch { rows = [{ accountId: '', accountName: '', status: 'failed' }] }
        memory = foldCheckin(state, rows, deps.now?.() ?? Date.now(), {
          perAccountDevice: deps.perAccountDevice?.() === true,
          random: deps.random,
        })
        await deps.write(memory)
      } finally { running = false }
    },
  }
}

/**
 * 新一天的首发窗口：`retryAt` 仍是 0（今天还没排过队）时，往后错开一段随机间隔。
 *
 * 返回未改动或改动过的状态；`retryAt` 相同即表示「不用错开，可以立刻跑」。
 */
function stageFirstAttempt(state: AutoCheckinState, now: number, random: (() => number) | undefined): AutoCheckinState {
  const spread = Math.round(FIRST_ATTEMPT_SPREAD_MS * spreadUnit(random ?? Math.random))
  if (spread <= 0) return state
  return { ...state, retryAt: now + spread }
}
