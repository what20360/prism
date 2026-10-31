import type { AttrSet } from './attrs'
import { ARSENAL_RULES } from './rules'
import type { Actor } from './world'
import { rageProfile, dashProfile } from './rules'

/** Temporary effects never mutate the permanent card pipeline. */
export function combatAttrs(actor: Actor): AttrSet {
  if (actor.rageTicks <= 0 && actor.dashTicks <= 0 && !(actor.shockTicks && actor.shockTicks > 0)) return actor.attrs
  const attrs = { ...actor.attrs }
  if (actor.rageTicks > 0) {
    const rage = rageProfile(attrs.rageLevel)
    attrs.damage *= rage.damageMultiplier; attrs.mineDamage *= rage.damageMultiplier
    attrs.armor += rage.armor; attrs.fireRate *= rage.fireRateMultiplier; attrs.lifesteal += rage.lifesteal
  }
  if (actor.dashTicks > 0) attrs.speed *= dashProfile(attrs.dashLevel).speedMultiplier
  if (actor.shockTicks && actor.shockTicks > 0) attrs.speed *= ARSENAL_RULES.shockSpeed
  return attrs
}
