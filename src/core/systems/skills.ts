import { TICK_RATE } from '../types'
import type { Actor, World } from '../world'

/**
 * Deflect / reflect are one skill with two levels (docs/requirements.md 5.7.4).
 * The window is opened by intent and consumed by incoming projectiles.
 */
export function tryActivateDeflect(world: World, actor: Actor): boolean {
  if (actor.attrs.deflectLevel <= 0) return false
  if (actor.deflectCooldownTicks > 0) return false
  if (actor.deflectWindowTicks > 0) return false

  actor.deflectWindowTicks = Math.round(actor.attrs.deflectWindowSeconds * TICK_RATE)
  actor.deflectCooldownTicks = Math.round(actor.attrs.deflectCooldownSeconds * TICK_RATE)
  world.effects.push({
    kind: 'deflect',
    x: actor.pos.x,
    y: actor.pos.y,
    radius: actor.radius + 16,
    ttl: 10,
  })
  return true
}
