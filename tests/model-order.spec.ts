/**
 * Ordering, grouping and search of the model catalog (issue #52, P0).
 *
 * WHY THIS FILE EXISTS. The reported symptom was a model list that read as "a
 * mess of old models", and half of that was ORDER: the card drew rows in the
 * order the merge happened to produce, while `solo-remote.ts` records that the
 * Remote directory's group order VARIES BETWEEN CALLS. So the same account could
 * see the same rows in two different arrangements after two refreshes. These
 * tests pin the replacement contract: the order is a pure function of the SET of
 * rows (channel priority, then display name), never of arrival.
 *
 * The grouping tests pin the other half of the fix: a header per channel is what
 * makes a union of a dozen Trae modes legible, and it must not lose or duplicate
 * a row on the way.
 */
import { describe, expect, it } from 'vitest'

import {
  filterTraeModels,
  groupTraeModels,
  orderTraeModels,
  traeModelMatchesQuery,
  TRAE_CHANNEL_PRIORITY,
} from '../src/model-order.ts'

interface Row {
  id: string
  name: string
  wireFunction?: string
  wireConfigName?: string
}

const row = (name: string, wireFunction?: string, wireConfigName?: string): Row => ({
  id: name,
  name,
  ...wireFunction === undefined ? {} : { wireFunction },
  ...wireConfigName === undefined ? {} : { wireConfigName },
})

describe('1. the channel priority is the region’s own wire order', () => {
  it('lists the CN chat functions in the order the bridge prefers them', () => {
    // The list is shared with `solo.ts` (which re-exports it): a second copy
    // would let the card draw channels in an order the resolver does not use.
    expect(TRAE_CHANNEL_PRIORITY.cn).toEqual([
      'solo_work_remote',
      'solo_work_lite',
      'solo_agent_remote',
      'chat_v3',
      'solo_coder',
    ])
  })

  it('drops the CN-only code channel on the international side', () => {
    expect(TRAE_CHANNEL_PRIORITY.ai).not.toContain('solo_coder')
  })
})

describe('2. orderTraeModels', () => {
  it('walks groups in priority order, not in the order the rows arrived', () => {
    const rows = [
      row('coder-model', 'solo_coder'),
      row('chat-model', 'chat_v3'),
      row('workspace-model', 'solo_work_remote'),
    ]
    expect(orderTraeModels(rows, 'cn').map(model => model.name))
      .toEqual(['workspace-model', 'chat-model', 'coder-model'])
  })

  it('sorts rows inside one channel by display name, case-insensitively', () => {
    const rows = [
      row('glm-5.2', 'solo_work_remote'),
      row('DeepSeek-V4-Pro', 'solo_work_remote'),
      row('Kimi-K3', 'solo_work_remote'),
    ]
    expect(orderTraeModels(rows, 'cn').map(model => model.name))
      .toEqual(['DeepSeek-V4-Pro', 'glm-5.2', 'Kimi-K3'])
  })

  it('compares embedded versions as numbers, so 5.10 follows 5.9', () => {
    // Plain text order puts "5.10" first, which reads as a bug to anyone
    // looking at version numbers.
    const rows = [row('GLM-5.10', 'solo_work_remote'), row('GLM-5.9', 'solo_work_remote')]
    expect(orderTraeModels(rows, 'cn').map(model => model.name)).toEqual(['GLM-5.9', 'GLM-5.10'])
  })

  it('puts rows with NO channel last — they are the ones the resolver knows least about', () => {
    const rows = [row('unknown-mode'), row('coder', 'solo_coder')]
    expect(orderTraeModels(rows, 'cn').map(model => model.name)).toEqual(['coder', 'unknown-mode'])
  })

  it('puts an unknown channel after every known one, and before the channel-less rows', () => {
    const rows = [row('none'), row('stray', 'builder_v3'), row('coder', 'solo_coder')]
    expect(orderTraeModels(rows, 'cn').map(model => model.name)).toEqual(['coder', 'stray', 'none'])
  })

  it('treats a channel the REGION does not call through as unknown', () => {
    // `solo_coder` is CN-only; on the international side it is a stray name, so
    // it must not jump ahead of chat_v3.
    const rows = [row('coder', 'solo_coder'), row('chat', 'chat_v3')]
    expect(orderTraeModels(rows, 'ai').map(model => model.name)).toEqual(['chat', 'coder'])
  })

  it('is independent of arrival order — the same set always gives the same list', () => {
    const rows = [
      row('b-model', 'solo_work_remote'),
      row('a-model', 'solo_work_remote'),
      row('c-model', 'chat_v3'),
      row('d-model'),
      row('e-model', 'solo_coder'),
    ]
    const forward = orderTraeModels(rows, 'cn').map(model => model.name)
    const backward = orderTraeModels([...rows].reverse(), 'cn').map(model => model.name)
    const shuffled = orderTraeModels([rows[2]!, rows[4]!, rows[0]!, rows[3]!, rows[1]!], 'cn').map(model => model.name)
    expect(backward).toEqual(forward)
    expect(shuffled).toEqual(forward)
  })

  it('breaks a same-name tie by id, so the result is still total', () => {
    const rows = [
      { id: 'b-config', name: 'Same Name', wireFunction: 'solo_work_remote' },
      { id: 'a-config', name: 'Same Name', wireFunction: 'solo_work_remote' },
    ]
    expect(orderTraeModels(rows, 'cn').map(model => model.id)).toEqual(['a-config', 'b-config'])
  })

  it('does not mutate the caller’s array', () => {
    const rows = [row('b', 'chat_v3'), row('a', 'solo_work_remote')]
    orderTraeModels(rows, 'cn')
    expect(rows.map(model => model.name)).toEqual(['b', 'a'])
  })
})

describe('3. groupTraeModels', () => {
  const rows = [
    row('coder', 'solo_coder'),
    row('first', 'solo_work_remote'),
    row('second', 'solo_work_remote'),
    row('stray'),
  ]

  it('returns groups in priority order, each with its rows already sorted', () => {
    const groups = groupTraeModels(rows, 'cn')
    expect(groups.map(group => group.channel)).toEqual(['solo_work_remote', 'solo_coder', undefined])
    expect(groups[0]?.rows.map(model => model.name)).toEqual(['first', 'second'])
  })

  it('loses and duplicates nothing', () => {
    const flat = groupTraeModels(rows, 'cn').flatMap(group => group.rows.map(model => model.name))
    expect([...flat].sort()).toEqual(rows.map(model => model.name).sort())
  })

  it('keeps one group per channel even when the rows for it arrive apart', () => {
    const split = [row('a', 'chat_v3'), row('b', 'solo_coder'), row('c', 'chat_v3')]
    const groups = groupTraeModels(split, 'cn')
    expect(groups.map(group => group.channel)).toEqual(['chat_v3', 'solo_coder'])
    expect(groups[0]?.rows.map(model => model.name)).toEqual(['a', 'c'])
  })

  it('treats an empty channel string as "no channel"', () => {
    expect(groupTraeModels([row('x', '')], 'cn')[0]?.channel).toBeUndefined()
  })
})

describe('4. search', () => {
  const deepSeek: Row = row('DeepSeek-V4-Flash', 'solo_work_remote', 'DeepSeek-V4-Flash-Official')

  it('matches the display name case-insensitively', () => {
    expect(traeModelMatchesQuery(deepSeek, 'deepseek')).toBe(true)
    expect(traeModelMatchesQuery(deepSeek, 'FLASH')).toBe(true)
  })

  it('matches the WIRE config name, not only the display name', () => {
    // Someone debugging a rejected config_name arrives with the upstream name;
    // on rows like this one it is not the name on screen.
    expect(traeModelMatchesQuery({ id: 'x', name: 'Flash' }, 'flash')).toBe(true)
    expect(traeModelMatchesQuery({ id: 'x', name: 'Flash', wireConfigName: 'Flash-Official' }, 'official')).toBe(true)
  })

  it('matches the id', () => {
    expect(traeModelMatchesQuery({ id: 'glm-5.2', name: 'GLM 5.2' }, 'glm-5')).toBe(true)
  })

  it('treats blank and whitespace-only queries as "everything"', () => {
    expect(filterTraeModels([deepSeek], '')).toHaveLength(1)
    expect(filterTraeModels([deepSeek], '   ')).toHaveLength(1)
  })

  it('filters in order and returns a copy', () => {
    const rows = [row('b-model', 'solo_work_remote'), row('a-model', 'solo_work_remote'), row('kimi', 'chat_v3')]
    const filtered = filterTraeModels(rows, 'model')
    expect(filtered.map(model => model.name)).toEqual(['b-model', 'a-model'])
    expect(filtered).not.toBe(rows)
  })

  it('returns nothing when nothing matches', () => {
    expect(filterTraeModels([deepSeek], 'gpt-6')).toEqual([])
  })
})
