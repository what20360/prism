import { combatAttrs } from '../combat'
import { distance } from '../collision'
import { firstWallHit } from '../navigation'
import { TICK_DT, TICK_RATE } from '../types'
import { MINE_RULES, mineSlowMultiplier } from '../rules'
import type { Actor, Mine, Projectile, World } from '../world'
import { allocateId } from '../world'
import { applyDamage } from './damage'
import { emitProjectile } from './weapons'
export const MINE_FUSE_TICKS = Math.round(0.08 * TICK_RATE)
export const MINE_PLACE_COOLDOWN_TICKS = TICK_RATE * 2
export const MAX_MINES_PER_TEAM = 3
export const MINE_BODY_RADIUS = 30
export const MINE_BLAST_RADIUS = 200
export const MINE_PROXIMITY_RATIO = 0.6
export const MINE_TRIGGER_RADIUS = 120
export const MINE_SLOW_RADIUS = 120
export const MINE_SLOW_MULTIPLIER = 2
export const MINE_DAMAGE = 30
export function tryPlaceMine(world: World, actor: Actor): void {
  if (actor.mineCooldownTicks > 0) return
  const attrs = combatAttrs(actor), owned = world.mines.filter((mine) => mine.ownerId === actor.id)
  const oldest = owned.length >= Math.max(1, Math.floor(attrs.mineLimit)) ? owned[0] : undefined
  if (oldest) removeMine(world, oldest)
  const moveLength = Math.hypot(actor.intent.move.x, actor.intent.move.y)
  const direction = moveLength > 0.01 ? { x: actor.intent.move.x / moveLength, y: actor.intent.move.y / moveLength } : { x: Math.cos(actor.aimAngle), y: Math.sin(actor.aimAngle) }
  const multiplier = Math.max(1, attrs.mineSlowMultiplier)
  world.mines.push({ id: allocateId(world), ownerId: actor.id, team: actor.team, pos: { ...actor.pos },
    bodyRadius: MINE_BODY_RADIUS, triggerRadius: attrs.mineTriggerRadius, blastRadius: attrs.mineBlastRadius,
    slowRadius: attrs.mineSlowRadius, slowMultiplier: mineSlowMultiplier(multiplier, attrs.mineIgnoreBullets > 0),
    damage: attrs.mineDamage, hp: attrs.mineHp, fuseTicks: null, fuseTotalTicks: Math.max(1, Math.round(attrs.mineFuseSeconds * TICK_RATE)),
    ignoreBullets: attrs.mineIgnoreBullets > 0, fragments: Math.floor(attrs.mineFragments),
    velocity: attrs.grenade > 0 ? { x: direction.x * MINE_RULES.grenadeSpeed, y: direction.y * MINE_RULES.grenadeSpeed } : undefined,
    travelLeft: attrs.grenade > 0 ? MINE_RULES.grenadeTravel : undefined })
  actor.mineCooldownTicks = Math.max(1, Math.round(attrs.mineCooldown / Math.max(0.01, attrs.mineCooldownRate) * TICK_RATE))
}
export function updateMines(world: World): void {
  const survivors: Mine[] = []
  for (const mine of world.mines) {
    if (mine.hp <= 0) continue
    if (mine.velocity && (mine.travelLeft ?? 0) > 0) {
      const speed = Math.hypot(mine.velocity.x, mine.velocity.y), travel = Math.min(mine.travelLeft!, speed * TICK_DT)
      const to = { x: mine.pos.x + mine.velocity.x / speed * travel, y: mine.pos.y + mine.velocity.y / speed * travel }
      const wall = firstWallHit(world.room, mine.pos, to, mine.bodyRadius)
      mine.pos = wall ? { x: mine.pos.x + (to.x - mine.pos.x) * wall.t, y: mine.pos.y + (to.y - mine.pos.y) * wall.t } : to
      mine.travelLeft = wall ? 0 : Math.max(0, mine.travelLeft! - travel)
    }
    if (mine.fuseTicks === null && (shouldTrigger(world, mine) || (mine.velocity && (mine.travelLeft ?? 0) <= 0))) mine.fuseTicks = mine.fuseTotalTicks ?? MINE_FUSE_TICKS
    if (mine.fuseTicks !== null && --mine.fuseTicks <= 0) { detonate(world, mine); continue }
    survivors.push(mine)
  }
  world.mines = survivors
}
function shouldTrigger(world: World, mine: Mine): boolean {
  for (const actor of world.actors.values()) if (actor.alive && actor.team !== mine.team && distance(actor.pos, mine.pos) <= mine.triggerRadius) return true
  if (!mine.ignoreBullets) for (const projectile of world.projectiles) if (projectile.team !== mine.team && distance(projectile.pos, mine.pos) <= mine.triggerRadius) return true
  return false
}
function detonate(world: World, mine: Mine): void {
  world.effects.push({ kind: 'explosion', x: mine.pos.x, y: mine.pos.y, radius: mine.blastRadius, ttl: 14 })
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === mine.team || distance(actor.pos, mine.pos) > mine.blastRadius) continue
    applyDamage(world, { targetId: actor.id, sourceId: mine.ownerId, sourceTeam: mine.team, raw: mine.damage, penetration: 0, isCore: false, kind: 'mine' })
  }
  world.projectiles = world.projectiles.filter((projectile) => projectile.team === mine.team || distance(projectile.pos, mine.pos) > mine.blastRadius)
  const owner = world.actors.get(mine.ownerId)
  if (owner?.alive) for (let i = 0; i < (mine.fragments ?? 0); i++) emitProjectile(world, owner, i / mine.fragments! * Math.PI * 2, mine.pos)
}
export function removeMine(world: World, mine: Mine): void { world.mines = world.mines.filter((candidate) => candidate.id !== mine.id) }
export function firstMineBodyHit(world: World, projectile: Projectile): Mine | undefined {
  return world.mines.find((mine) => !mine.ignoreBullets && mine.team !== projectile.team && distance(projectile.pos, mine.pos) <= projectile.radius + mine.bodyRadius)
}
