import { distance } from '../collision'
import { TICK_RATE } from '../types'
import type { Actor, Mine, Projectile, World } from '../world'
import { allocateId } from '../world'
import { applyDamage } from './damage'

export const MINE_FUSE_TICKS = Math.round(0.08 * TICK_RATE)
export const MINE_PLACE_COOLDOWN_TICKS = TICK_RATE * 2
export const MAX_MINES_PER_TEAM = 3
export const MINE_BODY_RADIUS = 30
export const MINE_TRIGGER_RADIUS = 80
export const MINE_BLAST_RADIUS = 200
export const MINE_SLOW_RADIUS = 80
export const MINE_SLOW_FACTOR = 0.6
export const MINE_DAMAGE = 30

export function tryPlaceMine(world: World, actor: Actor): void {
  if (actor.mineCooldownTicks > 0) return

  let owned = 0
  for (const mine of world.mines) {
    if (mine.ownerId === actor.id) owned += 1
  }
  if (owned >= MAX_MINES_PER_TEAM) return

  world.mines.push({
    id: allocateId(world),
    ownerId: actor.id,
    team: actor.team,
    pos: { x: actor.pos.x, y: actor.pos.y },
    bodyRadius: MINE_BODY_RADIUS,
    triggerRadius: MINE_TRIGGER_RADIUS,
    blastRadius: MINE_BLAST_RADIUS,
    slowRadius: MINE_SLOW_RADIUS,
    slowFactor: MINE_SLOW_FACTOR,
    damage: MINE_DAMAGE,
    hp: 1,
    fuseTicks: null,
  })

  actor.mineCooldownTicks = MINE_PLACE_COOLDOWN_TICKS
}

/** Step 8: trigger, fuse, slow field and area clear. */
export function updateMines(world: World): void {
  const survivors: Mine[] = []

  for (const mine of world.mines) {
    if (mine.hp <= 0) continue

    if (mine.fuseTicks === null && shouldTrigger(world, mine)) {
      mine.fuseTicks = MINE_FUSE_TICKS
    }

    if (mine.fuseTicks !== null) {
      mine.fuseTicks -= 1
      if (mine.fuseTicks <= 0) {
        detonate(world, mine)
        continue
      }
    }

    survivors.push(mine)
  }

  world.mines = survivors
}

/** Only opposing units and opposing bullets trigger a mine. */
function shouldTrigger(world: World, mine: Mine): boolean {
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === mine.team) continue
    if (distance(actor.pos, mine.pos) <= mine.triggerRadius) return true
  }

  for (const projectile of world.projectiles) {
    if (projectile.team === mine.team) continue
    if (distance(projectile.pos, mine.pos) <= mine.triggerRadius) return true
  }

  return false
}

function detonate(world: World, mine: Mine): void {
  world.effects.push({
    kind: 'explosion',
    x: mine.pos.x,
    y: mine.pos.y,
    radius: mine.blastRadius,
    ttl: 14,
  })

  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === mine.team) continue
    if (distance(actor.pos, mine.pos) > mine.blastRadius) continue

    applyDamage(world, {
      targetId: actor.id,
      sourceId: mine.ownerId,
      sourceTeam: mine.team,
      raw: mine.damage,
      penetration: 0,
      isCore: false,
    })
  }

  // Area clear: opposing bullets are removed outright, no bullet stats involved.
  world.projectiles = world.projectiles.filter((projectile) => {
    if (projectile.team === mine.team) return true
    return distance(projectile.pos, mine.pos) > mine.blastRadius
  })
}

export function removeMine(world: World, mine: Mine): void {
  world.mines = world.mines.filter((candidate) => candidate.id !== mine.id)
}

export function firstMineBodyHit(world: World, projectile: Projectile): Mine | undefined {
  for (const mine of world.mines) {
    if (mine.team === projectile.team) continue
    if (distance(projectile.pos, mine.pos) <= projectile.radius + mine.bodyRadius) {
      return mine
    }
  }
  return undefined
}
