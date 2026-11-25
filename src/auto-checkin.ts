/** 国内个人账号的后台签到，复用手动签到流程及设备限制。 */
import type { TraePoolCheckinRow } from './account-pool-run.ts'

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
  options: { perAccountDevice?: boolean } = {},
): AutoCheckinState {
  const done = new Set(state.done)
  for (const row of rows) if (row.status === 'already' || row.status === 'claimed') done.add(row.accountId)
  const perAccount = options.perAccountDevice === true
  if (perAccount) for (const row of rows) if (row.status === 'device-already') done.add(row.accountId)
  const failures = rows.some(row => row.status === 'failed') ? state.failures + 1 : 0
  const spent = perAccount
    ? state.deviceBlocked
    : state.deviceBlocked || rows.some(row => row.status === 'device-already' || row.status === 'claimed')
  return { day: state.day, done: [...done],
    deviceBlocked: spent,
    failures, retryAt: now + (rows.some(row => row.status === 'disabled') && failures === 0
      ? 30 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** Math.min(failures, 6))) }
}

export interface AutoCheckinDeps {
  enabled(): boolean
  read(): Promise<AutoCheckinState | undefined>
  write(state: AutoCheckinState): Promise<void>
  run(done: readonly string[]): Promise<readonly TraePoolCheckinRow[]>
  now?(): number
  /** 设备号是否按账号派生（`pool.perAccountCheckinDevice`），决定 `9095` 的语义。 */
  perAccountDevice?(): boolean
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
        if (stopped || !deps.enabled() || state.deviceBlocked || now < state.retryAt) return
        let rows: readonly TraePoolCheckinRow[]
        try { rows = await deps.run(state.done) }
        catch { rows = [{ accountId: '', accountName: '', status: 'failed' }] }
        memory = foldCheckin(state, rows, deps.now?.() ?? Date.now(), { perAccountDevice: deps.perAccountDevice?.() === true })
        await deps.write(memory)
      } finally { running = false }
    },
  }
}
