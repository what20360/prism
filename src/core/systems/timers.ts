import { shieldCap } from '../attrs'
import { TICK_RATE } from '../types'
import type { Effect, World } from '../world'
import { ARSENAL_RULES } from '../rules'
import { applyDamage } from './damage'

/** Chain breaks after 3 seconds without a kill. */
const CHAIN_IDLE_TICKS = 3 * TICK_RATE
/** Shield regeneration only starts after 3 seconds out of combat. */
const REGEN_DELAY_TICKS = 3 * TICK_RATE

/** Step 3: cooldowns, invulnerability, deflection, regen, chain timeout, effects. */
export function updateTimers(world: World): void {
  for (const actor of world.actors.values()) {
    if (actor.shockTicks) actor.shockTicks--
    if (actor.alive && actor.burn && --actor.burn.timer <= 0) {
      const burn = actor.burn
      burn.timer = ARSENAL_RULES.burnInterval; burn.remaining--
      if (burn.remaining <= 0) actor.burn = undefined
      applyDamage(world, { targetId: actor.id, sourceId: burn.sourceId, sourceTeam: burn.sourceTeam, raw: burn.raw, penetration: 0, isCore: false, kind: 'status', damageType: 'heat', rewardMultiplier: burn.rewardMultiplier })
    }
    if (actor.contactCooldownTicks) actor.contactCooldownTicks--
    if (actor.rageTicks > 0) actor.rageTicks -= 1
    if (actor.dashTicks > 0) actor.dashTicks -= 1
    if (actor.rageCooldownTicks > 0) actor.rageCooldownTicks -= 1
    if (actor.dashCooldownTicks > 0) actor.dashCooldownTicks -= 1
    if (actor.iframesTicks > 0) actor.iframesTicks -= 1
    if (actor.mineCooldownTicks > 0) actor.mineCooldownTicks -= 1
    if (actor.deflectWindowTicks > 0) actor.deflectWindowTicks -= 1
    if (actor.deflectCooldownTicks > 0) actor.deflectCooldownTicks -= 1

    if (actor.intent.fire === true || actor.intent.placeMine || (actor.laserTicks ?? 0) > 0) actor.outOfCombatTicks = 0
    else actor.outOfCombatTicks += 1

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
  if (world.traces) world.traces = world.traces.filter((trace) => --trace.ttl > 0)

  const visible = []
  for (const floater of world.floaters) {
    floater.ttl -= 1
    floater.y -= 0.8
    floater.x += floater.driftX
    if (floater.ttl > 0) visible.push(floater)
  }
  world.floaters = visible

  for (const actor of world.actors.values()) {
    if (actor.damageFlashTicks > 0) actor.damageFlashTicks -= 1
  }
}
