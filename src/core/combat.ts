import type { AttrSet } from './attrs'
import type { Actor } from './world'

/** Temporary effects never mutate the permanent card pipeline. */
export function combatAttrs(actor: Actor): AttrSet {
  if (actor.rageTicks <= 0 && actor.dashTicks <= 0) return actor.attrs
  const attrs = { ...actor.attrs }
  if (actor.rageTicks > 0) {
    attrs.damage *= 1.5; attrs.mineDamage *= 1.5
    attrs.armor += 30; attrs.fireRate *= 1.5; attrs.lifesteal += 0.1
  }
  if (actor.dashTicks > 0) attrs.speed *= 2.8
  return attrs
}
