import { distance } from '../collision'
import { TICK_RATE } from '../types'
import type { World } from '../world'

const SPECIAL_INTERVAL_TICKS = 6 * TICK_RATE
const CLEAR_RADIUS = 420

/**
 * Boss-only behaviour: lives in a second phase below 50% hp and periodically
 * clears the player's bullets around itself (requirements 6.2).
 */
export function updateBoss(world: World): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.behavior !== 'boss') continue

    if (actor.phase === 1 && actor.hp <= actor.attrs.maxHp * 0.5) {
      actor.phase = 2
      actor.attrs = {
        ...actor.attrs,
        fireRate: actor.attrs.fireRate * 1.5,
        multishot: actor.attrs.multishot + 4,
      }
      world.effects.push({
        kind: 'revive',
        x: actor.pos.x,
        y: actor.pos.y,
        radius: actor.radius * 2,
        ttl: 18,
      })
    }

    if (actor.specialCooldownTicks > 0) {
      actor.specialCooldownTicks -= 1
      continue
    }

    actor.specialCooldownTicks = SPECIAL_INTERVAL_TICKS
    world.projectiles = world.projectiles.filter(
      (projectile) =>
        projectile.team === 'enemy' || distance(projectile.pos, actor.pos) > CLEAR_RADIUS,
    )
    world.effects.push({
      kind: 'explosion',
      x: actor.pos.x,
      y: actor.pos.y,
      radius: CLEAR_RADIUS,
      ttl: 14,
    })
  }
}