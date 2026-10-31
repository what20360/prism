import { combatAttrs } from '../combat'
import { distance, resolveSpawnPosition, circleIntersectsRect } from '../collision'
import { firstWallHit, hasLineOfSight } from '../navigation'
import { TICK_DT, TICK_RATE } from '../types'
import { ARSENAL_RULES, MINE_RULES, mineSlowMultiplier, pulseProfile, broodProfile } from '../rules'
import type { Actor, Mine, Projectile, World } from '../world'
import { allocateId } from '../world'
import { applyDamage } from './damage'
import { emitProjectile } from './weapons'
import { enforceMineLimits, mineLimits } from '../mineLimits'
import { WEAVER_RULES } from '../weaverRules'
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
  enforceMineLimits(world, actor)
  const attrs = combatAttrs(actor), owned = world.mines.filter((mine) => mine.ownerId === actor.id && !mine.child)
  const oldest = owned.length >= Math.max(1, Math.floor(attrs.mineLimit)) ? owned[0] : undefined
  if (oldest) removeMine(world, oldest)
  const moveLength = Math.hypot(actor.intent.move.x, actor.intent.move.y)
  const direction = moveLength > 0.01 ? { x: actor.intent.move.x / moveLength, y: actor.intent.move.y / moveLength } : { x: Math.cos(actor.aimAngle), y: Math.sin(actor.aimAngle) }
  const multiplier = Math.max(1, attrs.mineSlowMultiplier)
  if (world.mines.length >= ARSENAL_RULES.mineLimit) removeMine(world, world.mines.find((m) => m.child) ?? world.mines[0]!)
  const pulses = pulseProfile(attrs.minePulseLevel)
  world.mines.push({ id: allocateId(world), ownerId: actor.id, team: actor.team, pos: { ...actor.pos },
    rewardMultiplier: actor.rewardMultiplier,
    bodyRadius: MINE_BODY_RADIUS, triggerRadius: attrs.mineTriggerRadius, blastRadius: attrs.mineBlastRadius,
    slowRadius: attrs.mineSlowRadius, slowMultiplier: mineSlowMultiplier(multiplier, attrs.mineIgnoreBullets > 0),
    damage: attrs.mineDamage / pulses.divisor, pulseCount: pulses.count, pulsesRemaining: pulses.count, broodLevel: attrs.mineBroodLevel, hp: attrs.mineHp, fuseTicks: null, fuseTotalTicks: Math.max(1, Math.round(attrs.mineFuseSeconds * TICK_RATE)),
    ignoreBullets: attrs.mineIgnoreBullets > 0, fragments: Math.floor(attrs.mineFragments),
    velocity: attrs.grenade > 0 ? { x: direction.x * MINE_RULES.grenadeSpeed, y: direction.y * MINE_RULES.grenadeSpeed } : undefined,
    travelLeft: attrs.grenade > 0 ? MINE_RULES.grenadeTravel : undefined })
  actor.mineCooldownTicks = Math.max(1, Math.round(attrs.mineCooldown / Math.max(0.01, attrs.mineCooldownRate) * TICK_RATE))
}
export function updateMines(world: World): void {
  for (const mine of [...world.mines]) {
    if (!world.mines.includes(mine)) continue
    if (mine.nestRole && !world.actors.get(mine.ownerId)?.alive) { removeMine(world, mine); continue }
    if (mine.hp <= 0 || (mine.expiresAt !== undefined && world.tick >= mine.expiresAt)) { removeMine(world, mine); continue }
    if (!mine.exploding && mine.velocity && (mine.travelLeft ?? 0) > 0) {
      const speed = Math.hypot(mine.velocity.x, mine.velocity.y), travel = Math.min(mine.travelLeft!, speed * TICK_DT)
      const to = { x: mine.pos.x + mine.velocity.x / speed * travel, y: mine.pos.y + mine.velocity.y / speed * travel }
      const wall = firstWallHit(world.room, mine.pos, to, mine.bodyRadius)
      mine.pos = wall ? { x: mine.pos.x + (to.x - mine.pos.x) * wall.t, y: mine.pos.y + (to.y - mine.pos.y) * wall.t } : to
      mine.travelLeft = wall ? 0 : Math.max(0, mine.travelLeft! - travel)
    }
    if (mine.fuseTicks === null && (shouldTrigger(world, mine) || (mine.velocity && (mine.travelLeft ?? 0) <= 0))) mine.fuseTicks = mine.fuseTotalTicks ?? MINE_FUSE_TICKS
    if (mine.fuseTicks !== null && --mine.fuseTicks <= 0) {
      mine.exploding = true; detonate(world, mine)
      mine.pulsesRemaining = (mine.pulsesRemaining ?? 1) - 1
      if (mine.pulsesRemaining > 0) mine.fuseTicks = ARSENAL_RULES.pulseGap
      else { removeMine(world, mine); finishMine(world, mine) }
    }
  }
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
    if (mine.nestRole && !hasLineOfSight(mine.pos, actor.pos, world.room.walls)) continue
    applyDamage(world, { targetId: actor.id, sourceId: mine.ownerId, sourceTeam: mine.team, raw: mine.damage, penetration: 0, isCore: false, kind: 'mine', damageType: 'heat', rewardMultiplier: mine.rewardMultiplier })
  }
  world.projectiles = world.projectiles.filter((projectile) => projectile.team === mine.team || distance(projectile.pos, mine.pos) > mine.blastRadius || mine.nestRole && !hasLineOfSight(mine.pos, projectile.pos, world.room.walls))
}
function finishMine(world: World, mine: Mine): void {
  if (!mine.child && (mine.broodLevel ?? 0) > 0) spawnChildren(world, mine)
  const owner = world.actors.get(mine.ownerId)
  if (owner?.alive) for (let i = 0; i < (mine.fragments ?? 0); i++) emitProjectile(world, owner, i / mine.fragments! * Math.PI * 2, mine.pos)
}
function spawnChildren(world: World, parent: Mine): void {
  const profile = broodProfile(parent.broodLevel!), owner = world.actors.get(parent.ownerId)
  if (!owner || owner.attrs.mineBroodLevel <= 0) return
  const cap = Math.min(ARSENAL_RULES.mineLimit, mineLimits(owner).children), scale = Math.sqrt(profile.inherit)
  for (let i = 0; i < Math.min(profile.children, cap); i++) {
    const old = world.mines.filter((m) => m.ownerId === parent.ownerId && m.child)
    if (old.length >= cap) removeMine(world, old[0]!)
    if (world.mines.length >= ARSENAL_RULES.mineLimit) { const child = world.mines.find((m) => m.child); if (!child) break; removeMine(world, child) }
    const angle = i / Math.min(profile.children, cap) * Math.PI * 2, radius = parent.bodyRadius * scale
    const pos = resolveSpawnPosition({ x: parent.pos.x + Math.cos(angle) * parent.blastRadius * 0.65, y: parent.pos.y + Math.sin(angle) * parent.blastRadius * 0.65 }, radius, world.room.walls, world.room.bounds)
    if (world.room.walls.some((w) => circleIntersectsRect(pos.x, pos.y, radius, w))) continue
    world.mines.push({ ...parent, id: allocateId(world), pos, child: true, broodLevel: 0, exploding: false, expiresAt: world.tick + profile.lifetime,
      bodyRadius: radius, blastRadius: parent.blastRadius * scale, triggerRadius: parent.triggerRadius * scale, slowRadius: parent.slowRadius * scale,
      slowMultiplier: 1 + (parent.slowMultiplier - 1) * profile.inherit, damage: parent.damage * profile.inherit, hp: Math.max(1, parent.hp * profile.inherit),
      fuseTicks: null, pulsesRemaining: parent.pulseCount ?? 1, velocity: undefined, travelLeft: undefined, fragments: Math.floor((parent.fragments ?? 0) * profile.inherit) })
  }
}

export function removeMine(world: World, mine: Mine): void {
  if (mine.nestRole && world.mines.some((m) => m.id === mine.id)) {
    const queen = world.actors.get(mine.ownerId)
    if (queen?.alive && queen.weaver && queen.weaver.lostMines.length < WEAVER_RULES.mineLimit) queen.weaver.lostMines.push({ ...mine.pos })
  }
  world.mines = world.mines.filter((candidate) => candidate.id !== mine.id)
}
export function firstMineBodyHit(world: World, projectile: Projectile): Mine | undefined {
  return world.mines.find((mine) => !mine.ignoreBullets && !mine.exploding && mine.team !== projectile.team && distance(projectile.pos, mine.pos) <= projectile.radius + mine.bodyRadius)
}
