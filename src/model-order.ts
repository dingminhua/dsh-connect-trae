/**
 * Order, group and search the model catalog (issue #52, P0).
 *
 * WHY THIS FILE EXISTS. Before it, the card rendered the catalog in the order
 * the merge happened to produce, and that order was not stable: the Remote
 * directory is grouped by function and `src/solo-remote.ts` documents that
 * "group order varies between calls", so two refreshes of the same account could
 * list the same 46 models in two different orders. The reporter's complaint
 * ("the list is a mess of historical models") had two halves, and P1 took the
 * first one away — twelve configs no chat function offers any more are retired
 * at discovery. This half is the ORDER: a row now lands in the group named by
 * the function it will actually be called through, groups follow the region's
 * own channel priority, and rows inside a group are sorted by display name.
 *
 * WHAT THIS IS NOT. It does not claim to reproduce the vendor's ranking. Trae's
 * own per-mode order exists (its picker is ordered), but it is not part of any
 * documented field we read, and the ONE ordering signal we did measure at group
 * level turned out to be unstable. Alphabetical inside a group is predictable
 * and re-derivable; a "smart" order we cannot verify would just be the same
 * guess with more code. Because the sort is total (channel, name, then id), the
 * output is a pure function of the SET of rows — never of their arrival order.
 *
 * PURE ON PURPOSE: the card bundle imports this module directly (see
 * `src/client/TraeUsageCard.tsx`), so it may not reach for `fetch`, `node:` or
 * anything in `solo.ts` — which is exactly why the channel priority lives HERE
 * and `solo.ts` re-exports it. Two copies of that list would eventually
 * disagree, and the disagreement would be invisible: the wire would ask channels
 * in one order while the card drew them in another.
 *
 * IT ALSO OWNS THE VIEW SCOPE (`scopeTraeModels`), the last piece of issue #52:
 * which rows a "normal chat" view shows and which are specialist-channel rows a
 * user has to widen to. Scoping lives here, next to the grouping, because both
 * answer the same question — "where will this turn actually go" — and a view
 * that disagreed with the group headers would be lying in the one place a user
 * goes to debug a `4001`.
 */
import type { TraeRegion } from './region.ts'

/**
 * Wire name of the default SOLO chat function.
 *
 * Lives here rather than in `solo.ts` so this module stays importable from the
 * client; `solo.ts` re-exports it, so there is still exactly one definition.
 */
export const TRAE_SOLO_FUNCTION = 'solo_work_lite'

/**
 * The chat functions of one region, in PRIORITY order.
 *
 * Two consumers read it, and both mean "priority", which is why they can share
 * one array: the wire asks these functions in order and the first to list a
 * config owns it (`solo.ts`), and the card draws the groups in the same order so
 * the row a user sees first is the one the resolver prefers.
 */
export const TRAE_CHANNEL_PRIORITY: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: ['solo_work_remote', TRAE_SOLO_FUNCTION, 'solo_agent_remote', 'chat_v3', 'solo_coder'],
  ai: ['solo_work_remote', TRAE_SOLO_FUNCTION, 'solo_agent_remote', 'chat_v3'],
}

/** The subset of a catalog row this module needs. */
export interface TraeOrderableModel {
  id: string
  name: string
  /** The directory function the row will be called through; absent = default. */
  wireFunction?: string
  /** The `config_name` to actually send; absent means `id` is the wire id. */
  wireConfigName?: string
}

/**
 * Rank of one channel inside the region's priority list.
 *
 * Three cases, and the order between them is deliberate:
 *
 *  - a known chat channel: its index in the priority list;
 *  - an UNKNOWN channel name (a function the region does not call through —
 *    `withChatCallableFunctions` clears those, so this is a defensive branch):
 *    after every known channel, then alphabetically among themselves;
 *  - NO channel at all (a row demoted to the default chat function): last. Such
 *    a row is the one the resolver knows least about, so it must not push a
 *    properly attributed row down the list.
 */
function channelRank(channel: string | undefined, priority: readonly string[]): number {
  if (channel === undefined || channel === '') return priority.length + 1
  const known = priority.indexOf(channel)
  return known === -1 ? priority.length : known
}

/**
 * Compare two display names the way a person reading a model list expects:
 * case-insensitively, with embedded numbers compared as NUMBERS, so `GLM-5.10`
 * sorts after `GLM-5.9`. Plain text comparison puts `5.10` first, which reads as
 * a bug to anyone who sees the version numbers.
 */
function compareNames(left: string, right: string): number {
  const byName = left.trim().localeCompare(right.trim(), undefined, { numeric: true, sensitivity: 'base' })
  return byName !== 0 ? byName : left.localeCompare(right)
}

/**
 * The catalog in display order: channel priority first, then name.
 *
 * Total and stable — ties fall through to `id`, so two rows with the same name
 * in the same channel still get one fixed order rather than the order they
 * arrived in.
 */
export function orderTraeModels<T extends TraeOrderableModel>(
  rows: readonly T[],
  region: TraeRegion = 'cn',
): T[] {
  const priority = TRAE_CHANNEL_PRIORITY[region] ?? TRAE_CHANNEL_PRIORITY.cn
  return [...rows].sort((left, right) => {
    const byRank = channelRank(left.wireFunction, priority) - channelRank(right.wireFunction, priority)
    if (byRank !== 0) return byRank
    // Same rank but different names (the unknown-channel bucket): alpha by
    // channel, so a stray function still groups together instead of scattering.
    if (left.wireFunction !== right.wireFunction) {
      return (left.wireFunction ?? '').localeCompare(right.wireFunction ?? '')
    }
    const byName = compareNames(left.name, right.name)
    return byName !== 0 ? byName : left.id.localeCompare(right.id)
  })
}

/** One rendered group: the channel and the rows attributed to it. */
export interface TraeModelGroup<T> {
  /** `undefined` for rows whose call function is unknown (they use the default). */
  channel: string | undefined
  rows: T[]
}

/**
 * Split rows into channel groups, in display order.
 *
 * Ordering is re-applied here rather than trusted from the caller: a group list
 * built from an unsorted input would put the groups in arrival order, which is
 * the exact instability this module exists to remove.
 */
export function groupTraeModels<T extends TraeOrderableModel>(
  rows: readonly T[],
  region: TraeRegion = 'cn',
): TraeModelGroup<T>[] {
  const groups: TraeModelGroup<T>[] = []
  const byChannel = new Map<string, TraeModelGroup<T>>()
  for (const row of orderTraeModels(rows, region)) {
    const channel = row.wireFunction === '' ? undefined : row.wireFunction
    const key = channel ?? '\u0000default'
    const existing = byChannel.get(key)
    if (existing !== undefined) {
      existing.rows.push(row)
      continue
    }
    const group: TraeModelGroup<T> = { channel, rows: [row] }
    byChannel.set(key, group)
    groups.push(group)
  }
  return groups
}

/**
 * Does one row match a search query?
 *
 * Matches the display name, the display id and the WIRE config name — the last
 * one because a user debugging a `4001 config_name rejected` arrives with the
 * upstream name in hand, and the two differ exactly on the rows that carry a
 * suffix (`DeepSeek-V4-Flash` vs `DeepSeek-V4-Flash-Official`).
 */
export function traeModelMatchesQuery(model: TraeOrderableModel, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (model.name.toLowerCase().includes(needle)) return true
  if (model.id.toLowerCase().includes(needle)) return true
  return (model.wireConfigName ?? '').toLowerCase().includes(needle)
}

/** Filter by {@link traeModelMatchesQuery}, preserving order. */
export function filterTraeModels<T extends TraeOrderableModel>(rows: readonly T[], query: string): T[] {
  if (query.trim() === '') return [...rows]
  return rows.filter(row => traeModelMatchesQuery(row, query))
}

/**
 * The channels a NORMAL Trae chat session actually runs on: the `solo_work_*`
 * family, i.e. the panel's own chat modes.
 *
 * Deliberately not "every channel we can call". After issue #52 P1 the catalog
 * is 34 rows and 10 of them are reachable only through a SPECIALIST channel:
 * `solo_coder` (7: `Doubao-Seed-2.0-Code`, `glm-5.1`, `glm-5v-turbo`,
 * `kimi-k2.5`, `minimax-m2.7`, `qwen-3.5`, `qwen-3.6-plus`), `chat_v3` (2:
 * `kimi-k2.8-preview`, `qwen3.8-flash`) and `solo_agent_remote` (1:
 * `Doubao-Seed-Code`). Measured 2026-10-23 on a live CN account. Those rows work
 * — that is why P1 kept them — but they are not what Trae's main chat offers,
 * and mixing them into the default view is exactly the "a code model answering a
 * solo request" shape issue #52 asked about.
 */
export const TRAE_COMMON_FUNCTIONS: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: ['solo_work_remote', TRAE_SOLO_FUNCTION],
  ai: ['solo_work_remote', TRAE_SOLO_FUNCTION],
}

/**
 * The function a request for this row will NAME.
 *
 * A row with no `wireFunction` is not "unknown to the wire": the bridge sends
 * the region default (`TRAE_SOLO_FUNCTION`), so for every question about where
 * the turn goes, the default is the answer. The distinction still matters for
 * DISPLAY (`groupTraeModels` keeps these in their own group, because their
 * provenance — which directory group advertised them — really is unknown), but
 * not for scope: a `solo_work_lite` turn is a normal chat turn either way.
 */
export function traeModelCallChannel(model: TraeOrderableModel): string {
  const channel = model.wireFunction
  return channel === undefined || channel === '' ? TRAE_SOLO_FUNCTION : channel
}

/** Which slice of the catalog a view asks for. */
export type TraeModelView =
  /** Rows a normal chat turn can reach: {@link TRAE_COMMON_FUNCTIONS}. */
  | 'common'
  /** Every callable row, specialist channels included. */
  | 'all'

/**
 * Does this row belong to the view?
 *
 * Judged on {@link traeModelCallChannel}, never on `wireFunction` directly:
 * otherwise the one row without a function (`doubao_1_8`, measured 2026-10-23)
 * would fall OUT of the common view while being called through exactly the
 * common channel it belongs to.
 */
export function traeModelInView(
  model: TraeOrderableModel,
  view: TraeModelView,
  region: TraeRegion = 'cn',
): boolean {
  if (view === 'all') return true
  const common = TRAE_COMMON_FUNCTIONS[region] ?? TRAE_COMMON_FUNCTIONS.cn
  return common.includes(traeModelCallChannel(model))
}

/** Keep the rows a view asks for, preserving order. */
export function scopeTraeModels<T extends TraeOrderableModel>(
  rows: readonly T[],
  view: TraeModelView,
  region: TraeRegion = 'cn',
): T[] {
  if (view === 'all') return [...rows]
  return rows.filter(row => traeModelInView(row, view, region))
}
