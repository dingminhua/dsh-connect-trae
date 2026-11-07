/** 只保存日期、账号 id 和重试进度，不保存凭据或上游错误正文。 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { AutoCheckinState } from './auto-checkin.ts'

export const autoCheckinPath = (): string => join(resolveDshHome(), '.trae-auto-checkin.cn.json')
export async function readAutoCheckin(): Promise<AutoCheckinState | undefined> {
  try {
    const value = JSON.parse(await readFile(autoCheckinPath(), 'utf8')) as Partial<AutoCheckinState>
    return typeof value.day === 'string' && Array.isArray(value.done) && value.done.every(id => typeof id === 'string')
      && typeof value.deviceBlocked === 'boolean' && typeof value.failures === 'number' && Number.isFinite(value.failures)
      && typeof value.retryAt === 'number' && Number.isFinite(value.retryAt) ? value as AutoCheckinState : undefined
  } catch { return undefined }
}
export async function writeAutoCheckin(state: AutoCheckinState): Promise<void> {
  const path = autoCheckinPath()
  await withFileLock(path, () => writeFileAtomic(path, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 }))
}
