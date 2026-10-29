import { shieldCap } from '../attrs'
import { TICK_RATE } from '../types'
import type { Effect, World } from '../world'

/** Chain breaks after 3 seconds without a kill. */
const CHAIN_IDLE_TICKS = 3 * TICK_RATE
/** Shield regeneration only starts after 3 seconds out of combat. */
const REGEN_DELAY_TICKS = 3 * TICK_RATE

/** Step 3: cooldowns, invulnerability, deflection, regen, chain timeout, effects. */
export function updateTimers(world: World): void {
  for (const actor of world.actors.values()) {
    if (actor.iframesTicks > 0) actor.iframesTicks -= 1
    if (actor.mineCooldownTicks > 0) actor.mineCooldownTicks -= 1
    if (actor.deflectWindowTicks > 0) actor.deflectWindowTicks -= 1
    if (actor.deflectCooldownTicks > 0) actor.deflectCooldownTicks -= 1

    actor.outOfCombatTicks += 1

    if (actor.alive && actor.attrs.shieldRegen > 0 && actor.outOfCombatTicks > REGEN_DELAY_TICKS) {
      actor.shield = Math.min(shieldCap(actor.attrs), actor.shield + actor.attrs.shieldRegen / TICK_RATE)
    }
  }

  if (world.stats.chain > 0) {
    world.stats.chainIdleTicks += 1
    if (world.stats.chainIdleTicks > CHAIN_IDLE_TICKS) {
      world.stats.chain = 0
      world.stats.chainIdleTicks = 0
    }
  }

  const alive: Effect[] = []
  for (const effect of world.effects) {
    effect.ttl -= 1
    if (effect.ttl > 0) alive.push(effect)
  }
  world.effects = alive
}