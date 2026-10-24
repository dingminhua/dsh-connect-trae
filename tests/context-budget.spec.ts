/**
 * The three-window context budget: dev, the 500K middle step, and Max.
 *
 * WHY THIS FILE EXISTS — the 500K option is a LOCAL preference, not a
 * Trae-advertised window, so nothing upstream will ever complain if the plugin
 * offers it for a model that cannot take it. Two failures are therefore
 * possible and both are silent:
 *
 *  1. offering 500K to a model whose Max is narrower (the user picks it, and
 *     the host silently keeps the dev window — a control that does nothing);
 *  2. `applyContextBudgets` accepting any number, so a stale saved 500K would
 *     overflow a model whose Max was later refreshed downwards.
 *
 * The eligibility rule and the acceptance rule must be the same rule, which is
 * why both sides call `contextBudgetOptions` and why this file pins its shape.
 */
import { describe, expect, it } from 'vitest'

import { contextBudgetOptions, TRAE_CONTEXT_BUDGET_MID } from '../src/context-budget.ts'
import { applyContextBudgets, type TraeModelInfo } from '../src/catalog.ts'

const MID = TRAE_CONTEXT_BUDGET_MID

describe('context budget options', () => {
  it('offers dev, 500K and Max for a typical 1M model', () => {
    expect(contextBudgetOptions({ contextWindow: 200_000, maxContextWindow: 1_000_000 })).toEqual([200_000, MID, 1_000_000])
    // The three shapes the live directories actually contain (2026-10-24):
    // CN defaults 200K/256K, GPT rows 272K, and MiMo's odd 981504 Max.
    expect(contextBudgetOptions({ contextWindow: 256_000, maxContextWindow: 1_000_000 })).toEqual([256_000, MID, 1_000_000])
    expect(contextBudgetOptions({ contextWindow: 272_000, maxContextWindow: 1_000_000 })).toEqual([272_000, MID, 1_000_000])
    expect(contextBudgetOptions({ contextWindow: 200_000, maxContextWindow: 981_504 })).toEqual([200_000, MID, 981_504])
  })

  it('never offers 500K when Max cannot reach it', () => {
    // A Max below the middle step: there is no legitimate 500K window here, and
    // offering one would be the "control that does nothing" failure.
    expect(contextBudgetOptions({ contextWindow: 200_000, maxContextWindow: 400_000 })).toEqual([200_000, 400_000])
  })

  it('does not duplicate a window that IS the middle step', () => {
    // Max exactly 500K: the middle step and Max are the same window.
    expect(contextBudgetOptions({ contextWindow: 200_000, maxContextWindow: MID })).toEqual([200_000, MID])
    // dev already 500K: the middle step would repeat the dev option.
    expect(contextBudgetOptions({ contextWindow: MID, maxContextWindow: 1_000_000 })).toEqual([MID, 1_000_000])
  })

  it('yields a single option for a model with no Max window', () => {
    // This is what makes the card's radios read-only for such models: one
    // option, already checked, and `disabled` because there is no Max.
    expect(contextBudgetOptions({ contextWindow: 200_000 })).toEqual([200_000])
  })
})

describe('applyContextBudgets honours only offered windows', () => {
  const model = (extra: Partial<TraeModelInfo> = {}): TraeModelInfo => ({
    id: 'm', name: 'm', contextWindow: 200_000, maxContextWindow: 1_000_000, input: ['text'], ...extra,
  })

  it('widens to the 500K middle step', () => {
    expect(applyContextBudgets([model()], { m: MID })[0]?.contextWindow).toBe(MID)
  })

  it('still widens to Max', () => {
    expect(applyContextBudgets([model()], { m: 1_000_000 })[0]?.contextWindow).toBe(1_000_000)
  })

  it('refuses an arbitrary number that is not an offered window', () => {
    // The pre-existing guard this must not weaken: a fabricated budget is not
    // a budget. 999_999 was the old regression, 500_001 is the new shape of it.
    expect(applyContextBudgets([model()], { m: 999_999 })[0]?.contextWindow).toBe(200_000)
    expect(applyContextBudgets([model()], { m: MID + 1 })[0]?.contextWindow).toBe(200_000)
  })

  it('refuses a stale 500K after Max shrinks below it', () => {
    // A model refreshed down to a 256K Max keeps a saved 500K. Widening to it
    // would overflow the window the gateway actually serves; falling back to
    // the dev window is the only safe answer.
    const shrunk = model({ maxContextWindow: 256_000 })
    expect(applyContextBudgets([shrunk], { m: MID })[0]?.contextWindow).toBe(200_000)
  })

  it('leaves the dev window when no budget is saved', () => {
    expect(applyContextBudgets([model()], {})[0]?.contextWindow).toBe(200_000)
  })
})
