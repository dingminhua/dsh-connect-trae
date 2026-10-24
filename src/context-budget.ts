/**
 * Context-budget arithmetic shared by the HOST (which applies a saved budget to
 * the catalog DSH is told about) and the CLIENT card (which renders the radios).
 *
 * It lives in its own module because the client bundle cannot import
 * `catalog.ts` (host-only) and the two sides must agree EXACTLY on which
 * windows are selectable: a card that offers a window the host then refuses
 * would be a control that silently does nothing.
 */

/**
 * The one intermediate budget the card offers, in tokens: 500K.
 *
 * WHY IT EXISTS: Trae advertises a dev window (typically 200K/256K/272K) and a
 * Max window (typically 1M). Switching dev→Max is a 5× jump for a user who
 * just wants more room without paying Max-tier pricing for the whole session.
 * 500K is the half-way point, and it is only ever offered for a model whose
 * Max window is at least that wide.
 *
 * WHY A CONSTANT AND NOT A PER-MODEL VALUE: this is a LOCAL preference that
 * DSH uses to decide when to compress; it is not a Trae-advertised window. The
 * value must be sane for every model that can select it, so eligibility is
 * gated on `maxContextWindow >= 500000` rather than inventing a window per
 * model. `applyContextBudgets` additionally refuses any budget wider than what
 * the model advertises, so a stale saved value cannot overflow a shrunken Max.
 */
export const TRAE_CONTEXT_BUDGET_MID = 500_000

/** The only fields {@link contextBudgetOptions} reads. */
export interface TraeContextWindows {
  contextWindow?: number
  maxContextWindow?: number
}

/**
 * The selectable windows for one model, smallest first: dev, then 500K (only
 * when it is a genuine middle step), then Max. Duplicates are dropped so a
 * model whose dev window is already 500K offers it once.
 *
 * A model with no Max window yields exactly one option — its dev window — which
 * is what makes the card's radios read-only for such models.
 */
export function contextBudgetOptions(model: TraeContextWindows): number[] {
  const dev = model.contextWindow
  const max = model.maxContextWindow
  const options: number[] = []
  const push = (value: number | undefined): void => {
    if (value === undefined || value < 1) return
    if (!options.includes(value)) options.push(value)
  }
  push(dev)
  // Only when it is a genuine step between the two: strictly wider than dev
  // (equal would duplicate the dev option) and no wider than Max (equal would
  // duplicate the Max option).
  if (max !== undefined && max >= TRAE_CONTEXT_BUDGET_MID && (dev === undefined || TRAE_CONTEXT_BUDGET_MID > dev)) {
    push(TRAE_CONTEXT_BUDGET_MID)
  }
  push(max)
  return options.sort((left, right) => left - right)
}
