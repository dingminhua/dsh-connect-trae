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

export function foldCheckin(state: AutoCheckinState, rows: readonly TraePoolCheckinRow[], now: number): AutoCheckinState {
  const done = new Set(state.done)
  for (const row of rows) if (row.status === 'already' || row.status === 'claimed') done.add(row.accountId)
  const failures = rows.some(row => row.status === 'failed') ? state.failures + 1 : 0
  return { day: state.day, done: [...done],
    deviceBlocked: state.deviceBlocked || rows.some(row => row.status === 'device-already' || row.status === 'claimed'),
    failures, retryAt: now + (rows.some(row => row.status === 'disabled') && failures === 0
      ? 30 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** Math.min(failures, 6))) }
}

export interface AutoCheckinDeps {
  enabled(): boolean
  read(): Promise<AutoCheckinState | undefined>
  write(state: AutoCheckinState): Promise<void>
  run(done: readonly string[]): Promise<readonly TraePoolCheckinRow[]>
  now?(): number
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
        memory = foldCheckin(state, rows, deps.now?.() ?? Date.now())
        await deps.write(memory)
      } finally { running = false }
    },
  }
}
