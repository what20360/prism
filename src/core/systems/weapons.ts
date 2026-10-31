import { combatAttrs } from '../combat'
import { hasLineOfSight } from '../navigation'
import { TICK_RATE } from '../types'
import { ARSENAL_RULES, homingProfile, penetrationProfile, WEAPON_RULES } from '../rules'
import { fireElectric, fireLaserPulse } from './energyWeapons'
import type { Vec2 } from '../types'
import type { Actor, World } from '../world'
import { allocateId } from '../world'
import { nearestOpponent } from './targeting'
export function hasBulletCapacity(world: World, actor: Actor): boolean {
  const cap = actor.attrs.maxProjectiles
  return cap <= 0 || world.projectiles.filter((p) => p.ownerId === actor.id && p.team === actor.team && p.pierceLeft > 0).length < cap
}
export function updateWeapons(world: World): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue
    const attrs = combatAttrs(actor), angle = resolveAimAngle(world, actor)
    if (attrs.maxProjectiles === 1) { actor.burstRemaining = 0; actor.burstTimer = 0 }
    if (angle !== undefined) actor.aimAngle = angle
    if (actor.fireCooldownTicks > 0) actor.fireCooldownTicks -= 1
    if (attrs.weapon !== 0) {
      actor.burstRemaining = 0; actor.burstTimer = 0
      if (attrs.weapon === 2 && (actor.laserTicks ?? 0) > 0) { updateLaser(world, actor); continue }
      if (actor.fireCooldownTicks > 0 || attrs.fireRate <= 0 || actor.intent.fire === false || angle === undefined) continue
      if (attrs.weapon === 1) fireElectric(world, actor, angle)
      else { actor.laserTicks = Math.max(1, Math.round(ARSENAL_RULES.laserTicks * attrs.burstCount)); actor.laserTimer = 0; updateLaser(world, actor) }
      actor.fireCooldownTicks = Math.max(1, Math.round(TICK_RATE / attrs.fireRate)); continue
    }
    if (actor.burstTimer > 0) actor.burstTimer -= 1
    if (actor.burstRemaining > 0) {
      if (actor.burstTimer <= 0 && hasBulletCapacity(world, actor)) {
        fireAt(world, actor, actor.burstAngle); actor.burstRemaining -= 1; actor.burstTimer = WEAPON_RULES.burstGapTicks
      }
      continue
    }
    if (actor.fireCooldownTicks > 0 || attrs.fireRate <= 0 || actor.intent.fire === false || !hasBulletCapacity(world, actor)) continue
    if (actor.behavior === 'boss') {
      const count = Math.max(1, Math.floor(attrs.multishot))
      for (let i = 0; i < count; i++) emitProjectile(world, actor, i / count * Math.PI * 2 + world.tick * 0.02)
    } else {
      if (angle === undefined) continue
      fireAt(world, actor, angle)
      actor.burstRemaining = attrs.maxProjectiles === 1 ? 0 : Math.max(0, Math.floor(attrs.burstCount) - 1)
      actor.burstTimer = WEAPON_RULES.burstGapTicks; actor.burstAngle = angle
    }
    actor.fireCooldownTicks = Math.max(1, Math.round(TICK_RATE / attrs.fireRate))
  }
}
function updateLaser(world: World, actor: Actor): void {
  if ((actor.laserTimer ?? 0) <= 0) { fireLaserPulse(world, actor, actor.aimAngle); actor.laserTimer = ARSENAL_RULES.laserGap }
  actor.laserTimer!--; actor.laserTicks!--
}
function resolveAimAngle(world: World, actor: Actor): number | undefined {
  if (actor.behavior === 'boss') return undefined
  if (actor.intent.autoAim) {
    const target = actor.lockTargetId === null ? undefined : world.actors.get(actor.lockTargetId)
    if (target?.alive && target.team !== actor.team) return Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x)
  }
  const aim = actor.intent.aim
  if (aim && (aim.x !== 0 || aim.y !== 0)) return Math.atan2(aim.y, aim.x)
  const target = nearestOpponent(world, actor, actor.attrs.range)
  if (!target || !hasLineOfSight(actor.pos, target.pos, world.room.walls)) return undefined
  return Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x)
}
function fireAt(world: World, actor: Actor, angle: number): void {
  const count = Math.max(1, Math.floor(actor.attrs.multishot))
  for (let i = 0; i < count; i++) emitProjectile(world, actor, angle + (i - (count - 1) / 2) * WEAPON_RULES.spreadStep)
}
/** Central emitter enforces sniper capacity for guns, bursts and mine fragments. */
export function emitProjectile(world: World, actor: Actor, angle: number, origin?: Vec2): boolean {
  if (!hasBulletCapacity(world, actor)) return false
  if (world.projectiles.length >= ARSENAL_RULES.projectileLimit) world.projectiles.shift()
  const attrs = combatAttrs(actor), dx = Math.cos(angle), dy = Math.sin(angle)
  const pos = origin ?? { x: actor.pos.x + dx * actor.radius * 0.5, y: actor.pos.y + dy * actor.radius * 0.5 }
  const profile = homingProfile(attrs.homing)
  const penetration = penetrationProfile(attrs.pierceBoost)
  const speed = attrs.bulletSpeed * profile.initialMultiplier
  world.projectiles.push({ id: allocateId(world), ownerId: actor.id, team: actor.team,
    damageType: actor.attackType ?? 'physical',
    rewardMultiplier: actor.rewardMultiplier,
    pos: { ...pos }, prevPos: { ...pos }, vel: { x: dx * speed, y: dy * speed }, radius: attrs.bulletSize,
    damage: attrs.damage, penetration: attrs.penetration, pierceLeft: Math.max(1, Math.floor(attrs.pierce)),
    innerMult: attrs.innerDamageMult, travelLeft: attrs.range, rangeBudget: attrs.range, hitIds: [], ricochet: attrs.ricochet > 0,
    blastRadius: attrs.blastRadius, targetId: actor.lockTargetId,
    homingTurn: profile.turnRate,
    pierceSpeedMultiplier: penetration.speedMultiplier, pierceRangeGain: penetration.rangeGain,
    cruiseSpeed: attrs.bulletSpeed * profile.cruiseMultiplier, trail: [] })
  return true
}
