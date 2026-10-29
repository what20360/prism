import { normalize, scale } from '../math'
import { TICK_RATE } from '../types'
import type { Actor, World } from '../world'
import { allocateId } from '../world'
import { nearestOpponent } from './targeting'

const SPREAD_STEP = 0.12

/** Step 5: fire timers and projectile spawning. Shared by player and AI. */
export function updateWeapons(world: World): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue
    if (actor.fireCooldownTicks > 0) {
      actor.fireCooldownTicks -= 1
      continue
    }
    if (actor.attrs.fireRate <= 0) continue

    const target = nearestOpponent(world, actor, actor.attrs.range)
    if (!target) continue

    fireAt(world, actor, target)
    actor.fireCooldownTicks = Math.max(1, Math.round(TICK_RATE / actor.attrs.fireRate))
  }
}

function fireAt(world: World, actor: Actor, target: Actor): void {
  const dir = normalize({ x: target.pos.x - actor.pos.x, y: target.pos.y - actor.pos.y })
  const count = Math.max(1, Math.floor(actor.attrs.multishot))
  // Keep the muzzle inside the actor: a larger offset makes point-blank shots
  // spawn past an overlapping enemy and never connect.
  const muzzleOffset = actor.radius * 0.5
  const base = normalize({ x: dir.x, y: dir.y })
  const baseAngle = Math.atan2(base.y, base.x)

  for (let i = 0; i < count; i += 1) {
    const offset = (i - (count - 1) / 2) * SPREAD_STEP
    const angle = baseAngle + offset
    const shotDir = { x: Math.cos(angle), y: Math.sin(angle) }

    world.projectiles.push({
      id: allocateId(world),
      ownerId: actor.id,
      team: actor.team,
      pos: {
        x: actor.pos.x + shotDir.x * muzzleOffset,
        y: actor.pos.y + shotDir.y * muzzleOffset,
      },
      prevPos: {
        x: actor.pos.x + shotDir.x * muzzleOffset,
        y: actor.pos.y + shotDir.y * muzzleOffset,
      },
      vel: scale(shotDir, actor.attrs.bulletSpeed),
      radius: actor.attrs.bulletSize,
      damage: actor.attrs.damage,
      penetration: actor.attrs.penetration,
      pierceLeft: Math.max(1, Math.floor(actor.attrs.pierce)),
      innerMult: actor.attrs.innerDamageMult,
      travelLeft: actor.attrs.range,
      hitIds: [],
    })
  }
}
