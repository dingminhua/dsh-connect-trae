/**
 * Warn before a build rewrites the bytes a LIVE DSH host is serving.
 *
 * WHY THIS FILE EXISTS — a real incident, 2026-10-24:
 *
 *   The normal developer setup installs this bundle into a profile by
 *   SYMLINK (`node_modules/dsh-connect-trae -> <this repo>`), so the running
 *   DSH host serves THIS repository's `lib/` bytes. Rebuilding therefore
 *   rewrites the client bundle under a live host, which re-imports it — and
 *   that is not a theoretical risk: at 14:40:08 / 14:41:01 / 14:42:16 the
 *   desktop app's renderer process died three times in a row
 *   (EXC_BREAKPOINT/SIGTRAP), and the app had to be restarted by hand.
 *
 *   The rebuild in `scripts/verify-release.mjs` was one such rebuild (it now
 *   builds in a throwaway worktree instead). The ordinary dev build still
 *   writes `lib/` in place — that is the point of it: it is how a developer
 *   pushes a change into the running app. So the hazard cannot be removed
 *   from the build; it can only be ANNOUNCED.
 *
 * WHAT IT DOES: nothing but warn. It never fails the build, because the
 * legitimate workflow (host running, rebuild, hot reload) must keep working.
 * It exits 0 always.
 *
 * WHAT IT CHECKS:
 *   1. Is a DSH profile's `node_modules` a symlink INTO this repository? (If
 *      not, a build here cannot affect any host.)
 *   2. Is a DSH host process alive right now?
 * Both together mean "a live host is serving bytes this build is about to
 * replace".
 */
import { readdir, readlink, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Profiles that link THIS repository into their `node_modules`. */
async function linkedProfiles() {
  const profilesRoot = join(homedir(), '.dsh', 'profiles')
  let entries
  try {
    entries = await readdir(profilesRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const linked = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const bundle = join(profilesRoot, entry.name, 'node_modules', 'dsh-connect-trae')
    let target
    try {
      target = await readlink(bundle)
    } catch {
      continue
    }
    const resolved = resolve(dirname(bundle), target)
    if (resolved === repo) linked.push(entry.name)
  }
  return linked
}

/** Is a DSH host process alive right now? */
async function liveHosts() {
  try {
    const { stdout } = await execFileAsync('ps', ['-Ao', 'command'], { maxBuffer: 8 * 1024 * 1024 })
    return stdout
      .split('\n')
      .filter(line => line.includes('dsh-desktop-host') || line.includes('dsh/lib/bin.js'))
  } catch {
    return []
  }
}

const profiles = await linkedProfiles()
const hosts = await liveHosts()

if (profiles.length > 0 && hosts.length > 0) {
  const note = [
    '',
    '  ⚠️  这次构建会改写正在被 DSH 宿主服务的插件字节。',
    '',
    `     profile：${profiles.join(', ')}（node_modules/dsh-connect-trae 是指向本仓库的软链）`,
    `     活着的宿主进程：${hosts.length} 个`,
    '',
    '     宿主会重新 import 客户端 bundle。2026-10-24 14:40 这样连崩过三次渲染进程',
    '     （EXC_BREAKPOINT/SIGTRAP），最后要人工重启应用。',
    '',
    '     如果你只是想验证发布内容：scripts/verify-release.mjs 已在临时副本里重建，',
    '     不碰工作树。',
    '     如果你确实要热更新：崩溃是已知的代价，重启应用即可恢复。',
    '',
  ].join('\n')
  console.log(note)
}
