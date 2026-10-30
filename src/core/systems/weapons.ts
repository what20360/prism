import { scale } from '../math'
import { TICK_RATE } from '../types'
import type { Actor, World } from '../world'
import { allocateId } from '../world'
import { nearestOpponent } from './targeting'

const SPREAD_STEP = 0.12

/**
 * Step 5: fire timers and projectile spawning. Shared by player and AI.
 * Aim comes from the intent when a controller supplies one (manual aim),
 * otherwise from the nearest opponent in range (auto aim).
 */
export function updateWeapons(world: World): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue

    const angle = resolveAimAngle(world, actor)
    if (angle !== undefined) actor.aimAngle = angle

    if (actor.fireCooldownTicks > 0) {
      actor.fireCooldownTicks -= 1
      continue
    }
    if (actor.attrs.fireRate <= 0) continue
    if (actor.intent.fire === false) continue

    if (actor.behavior === 'boss') {
      fireRadial(world, actor)
    } else if (angle !== undefined) {
      fireAt(world, actor, angle)
    } else {
      continue
    }

    actor.fireCooldownTicks = Math.max(1, Math.round(TICK_RATE / actor.attrs.fireRate))
  }
}

/** Manual aim wins; the boss fires rings and needs no aim at all. */
function resolveAimAngle(world: World, actor: Actor): number | undefined {
  if (actor.behavior === 'boss') return undefined

  const aim = actor.intent.aim
  if (aim && (aim.x !== 0 || aim.y !== 0)) return Math.atan2(aim.y, aim.x)

  const target = nearestOpponent(world, actor, actor.attrs.range)
  if (!target) return undefined
  return Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x)
}

function fireAt(world: World, actor: Actor, baseAngle: number): void {
  const count = Math.max(1, Math.floor(actor.attrs.multishot))

  for (let i = 0; i < count; i += 1) {
    const offset = (i - (count - 1) / 2) * SPREAD_STEP
    emit(world, actor, baseAngle + offset)
  }
}

/** Boss fires evenly spaced rings; the offset rotates with the tick, deterministically. */
function fireRadial(world: World, actor: Actor): void {
  const count = Math.max(1, Math.floor(actor.attrs.multishot))
  const spin = world.tick * 0.02

  for (let i = 0; i < count; i += 1) {
    emit(world, actor, (i / count) * Math.PI * 2 + spin)
  }
}

function emit(world: World, actor: Actor, angle: number): void {
  const shotDir = { x: Math.cos(angle), y: Math.sin(angle) }
  // Keep the muzzle inside the actor: a larger offset makes point-blank shots
  // spawn past an overlapping enemy and never connect.
  const muzzleOffset = actor.radius * 0.5

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