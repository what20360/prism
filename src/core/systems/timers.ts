import { TICK_RATE } from '../types'
import type { Effect, World } from '../world'

/** Chain breaks after 3 seconds without a kill. */
const CHAIN_IDLE_TICKS = 3 * TICK_RATE

/** Step 3: cooldowns, invulnerability, chain timeout, effect lifetimes. */
export function updateTimers(world: World): void {
  for (const actor of world.actors.values()) {
    if (actor.iframesTicks > 0) actor.iframesTicks -= 1
    if (actor.mineCooldownTicks > 0) actor.mineCooldownTicks -= 1
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
