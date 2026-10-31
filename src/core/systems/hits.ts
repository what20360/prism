import { distance, distanceToRay } from '../collision'
import type { Vec2 } from '../types'
import type { Actor, EffectKind, Projectile, World } from '../world'
import { applyDamage } from './damage'
import { removeMine } from './mines'

export function resolveHits(world: World): void {
  const initial = [...world.projectiles], removed = new Set<number>()
  for (const projectile of initial) if (world.projectiles.includes(projectile) && projectile.resolvedTick !== world.tick && resolveProjectilePath(world, projectile, projectile.prevPos, projectile.pos) === 'stopped') removed.add(projectile.id)
  world.projectiles = world.projectiles.filter((p) => !removed.has(p.id))
}
function contactTime(from: Vec2, to: Vec2, centre: Vec2, radius: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y, x = from.x - centre.x, y = from.y - centre.y
  const c = x * x + y * y - radius * radius
  if (c <= 0) return 0
  const a = dx * dx + dy * dy
  if (a < 1e-12) return null
  const b = 2 * (x * dx + y * dy), discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const t = (-b - Math.sqrt(discriminant)) / (2 * a)
  return t >= 0 && t <= 1 ? t : null
}
/** Hits are resolved in flight order before wall bounce costs are spent. */
export function resolveProjectilePath(world: World, projectile: Projectile, from: Vec2, to: Vec2): 'alive' | 'stopped' | 'reflected' {
  for (let i = projectile.hitIds.length - 1; i >= 0; i--) {
    const actor = world.actors.get(projectile.hitIds[i]!)
    if (!actor?.alive || distance(from, actor.pos) > projectile.radius + actor.radius + 1e-5) projectile.hitIds.splice(i, 1)
  }
  const contacts: { t: number; id: number; actor?: Actor; mine?: typeof world.mines[number] }[] = []
  for (const mine of world.mines) {
    if (mine.team === projectile.team || mine.ignoreBullets || mine.hp <= 0 || mine.exploding) continue
    const t = contactTime(from, to, mine.pos, projectile.radius + mine.bodyRadius)
    if (t !== null) contacts.push({ t, id: mine.id, mine })
  }
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === projectile.team || projectile.hitIds.includes(actor.id)) continue
    const t = contactTime(from, to, actor.pos, projectile.radius + actor.radius)
    if (t !== null) contacts.push({ t, id: actor.id, actor })
  }
  contacts.sort((a, b) => a.t - b.t || a.id - b.id)
  for (const contact of contacts) {
    if (contact.mine) { contact.mine.hp -= projectile.damage; if (contact.mine.hp <= 0) removeMine(world, contact.mine); return 'stopped' }
    const target = contact.actor!
    if (!target.alive) continue
    if (tryDeflect(world, projectile, target)) {
      projectile.pos = { x: from.x + (to.x - from.x) * contact.t, y: from.y + (to.y - from.y) * contact.t }
      const cap = target.attrs.maxProjectiles
      if (cap > 0 && world.projectiles.filter((other) => other !== projectile && other.ownerId === target.id && other.team === target.team && other.pierceLeft > 0).length >= cap) return 'stopped'
      return 'reflected'
    }
    const core = target.hasCore ? target.radius * target.attrs.coreRadiusMult : 0
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const isCore = core > 0 && projectile.pierceLeft >= 2 && distanceToRay(target.pos.x, target.pos.y, from.x, from.y,
      length ? (to.x - from.x) / length : Math.cos(Math.atan2(projectile.vel.y, projectile.vel.x)),
      length ? (to.y - from.y) / length : Math.sin(Math.atan2(projectile.vel.y, projectile.vel.x))) <= core
    if (isCore) world.stats.coreHits += 1
    applyDamage(world, { targetId: target.id, sourceId: projectile.ownerId, sourceTeam: projectile.team,
      raw: projectile.damage * (isCore ? projectile.innerMult : 1), penetration: projectile.penetration, isCore, kind: 'bullet', damageType: projectile.damageType, rewardMultiplier: projectile.rewardMultiplier })
    const radius = projectile.blastRadius ?? 0
    if (radius > 0) {
      world.effects.push({ kind: 'explosion', x: target.pos.x, y: target.pos.y, radius, ttl: 14 })
      for (const other of world.actors.values()) {
        if (!other.alive || other.team === projectile.team || other.id === target.id || distance(other.pos, target.pos) > radius + other.radius) continue
        applyDamage(world, { targetId: other.id, sourceId: projectile.ownerId, sourceTeam: projectile.team, raw: projectile.damage, penetration: projectile.penetration, isCore: false, kind: 'bullet', damageType: projectile.damageType, rewardMultiplier: projectile.rewardMultiplier })
      }
    }
    projectile.hitIds.push(target.id); projectile.pierceLeft -= isCore ? 2 : 1
    if (projectile.pierceLeft <= 0) return 'stopped'
    const boost = projectile.pierceSpeedMultiplier ?? 1
    projectile.vel = { x: Math.sign(projectile.vel.x) * Math.min(Number.MAX_VALUE, Math.abs(projectile.vel.x) * boost), y: Math.sign(projectile.vel.y) * Math.min(Number.MAX_VALUE, Math.abs(projectile.vel.y) * boost) }
    if (projectile.cruiseSpeed !== undefined) projectile.cruiseSpeed = Math.min(Number.MAX_VALUE, projectile.cruiseSpeed * boost)
    grantRange(projectile, projectile.pierceRangeGain ?? 0)
  }
  return 'alive'
}
function grantRange(projectile: Projectile, amount: number): void {
  projectile.rangeBudget = Math.min(Number.MAX_VALUE, (projectile.rangeBudget ?? projectile.travelLeft) + amount)
  projectile.travelLeft = Math.min(Number.MAX_VALUE, projectile.travelLeft + amount)
}
function tryDeflect(world: World, projectile: Projectile, target: Actor): boolean {
  if (projectile.team === target.team || target.deflectWindowTicks <= 0 || target.attrs.deflectLevel <= 0) return false
  projectile.team = target.team; projectile.ownerId = target.id; projectile.hitIds.length = 0
  projectile.rewardMultiplier = target.rewardMultiplier
  projectile.targetId = target.lockTargetId; grantRange(projectile, Math.max(0, 500 - projectile.travelLeft))
  projectile.vel = { x: -projectile.vel.x, y: -projectile.vel.y }
  let kind: EffectKind = 'deflect'
  if (target.attrs.deflectLevel >= 2) { projectile.damage *= target.attrs.reflectDamageMult; kind = 'reflect' }
  world.effects.push({ kind, x: projectile.pos.x, y: projectile.pos.y, radius: 34, ttl: 14 })
  return true
}
