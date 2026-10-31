import type { CardState } from '../core/progress'
import type { PurchasePlan } from './upgradePlans'
export const PURCHASE_NOTICE_TICKS = 180
export interface PurchaseNotice { id: string; level: number; price: number; remainingTicks: number; auto: boolean }
/** Tick time counts only while the eligible offer can be shown in active play. */
export function createPurchaseQueue() {
  let signature = '', elapsed = 0
  const update = (plan: PurchasePlan, cards: readonly CardState[], ticks: number, buy: (id: string) => boolean, retainTargets = false): PurchaseNotice | null => {
    if (!retainTargets) while (plan.targets.length && cards.some((c) => c.id === plan.targets[0]!.id && c.level >= plan.targets[0]!.level)) plan.targets.shift()
    const target = retainTargets ? plan.targets.find((t) => cards.some((c) => c.id === t.id && c.level < t.level)) : plan.targets[0]
    const card = target && cards.find((c) => c.id === target.id)
    if (plan.quickMode === 'favorites') { signature = ''; elapsed = 0; return null }
    if (!card || card.availability !== 'ok') { signature = ''; elapsed = 0; return null }
    const next = `${card.id}:${card.level}:${card.price}:${plan.enabled}`
    if (signature !== next) { signature = next; elapsed = 0 }
    else if (plan.enabled) elapsed += Math.max(0, ticks)
    if (plan.enabled && elapsed >= PURCHASE_NOTICE_TICKS && buy(card.id)) { signature = ''; elapsed = 0; return null }
    return { id: card.id, level: card.level + 1, price: card.price, remainingTicks: Math.max(0, PURCHASE_NOTICE_TICKS - elapsed), auto: plan.enabled }
  }
  return { update, reset: () => { signature = ''; elapsed = 0 } }
}
