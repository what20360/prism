import type { AttrSet } from './attrs'
import { ARSENAL_RULES, COMBAT_RULES, SNIPER_RULES } from './rules'
import type { Actor } from './world'
import { rageProfile, dashProfile } from './rules'

export function isAttacking(actor: Actor): boolean { return actor.intent.fire === true || (actor.electricBudget??0)>0 || actor.intent.placeMine === true || (actor.laserTicks ?? 0) > 0 || actor.burstRemaining > 0 }
export function isOutOfCombat(actor: Actor): boolean { return actor.outOfCombatTicks >= COMBAT_RULES.outOfCombatTicks && !isAttacking(actor) }
/** Temporary effects never mutate the permanent card pipeline. */
export function combatAttrs(actor: Actor): AttrSet {
  if (actor.rageTicks <= 0 && actor.dashTicks <= 0 && !(actor.shockTicks && actor.shockTicks > 0) && !(actor.attrs.weapon === 3 && isOutOfCombat(actor))) return actor.attrs
  const attrs = { ...actor.attrs }
  if (actor.rageTicks > 0) {
    const rage = rageProfile(attrs.rageLevel)
    attrs.damage *= rage.damageMultiplier; attrs.damageScale *= rage.damageMultiplier; attrs.mineDamage *= rage.damageMultiplier
    attrs.armor += rage.armor; attrs.fireRate *= rage.fireRateMultiplier; attrs.lifesteal += rage.lifesteal
  }
  if (actor.dashTicks > 0) attrs.speed *= dashProfile(attrs.dashLevel).speedMultiplier
  if (actor.shockTicks && actor.shockTicks > 0) attrs.speed *= ARSENAL_RULES.shockSpeed
  if (attrs.weapon === 3 && isOutOfCombat(actor)) attrs.speed = attrs.speed / SNIPER_RULES.speedMultiplier ** attrs.sniperPower * SNIPER_RULES.travelMultiplier
  return attrs
}
