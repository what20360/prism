import { distance, distanceToRay } from '../collision'
import type { Vec2 } from '../types'
import type { Actor, EffectKind, Projectile, World } from '../world'
import { applyDamage } from './damage'
import { removeMine } from './mines'

export function resolveHits(world: World): void {
  world.projectiles = world.projectiles.filter((projectile) => projectile.resolvedTick === world.tick ||
    resolveProjectilePath(world, projectile, projectile.prevPos, projectile.pos) !== 'stopped')
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
  const contacts: { t: number; id: number; actor?: Actor; mine?: typeof world.mines[number] }[] = []
  for (const mine of world.mines) {
    if (mine.team === projectile.team || mine.ignoreBullets || mine.hp <= 0) continue
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
      raw: projectile.damage * (isCore ? projectile.innerMult : 1), penetration: projectile.penetration, isCore, kind: 'bullet' })
    const radius = projectile.blastRadius ?? 0
    if (radius > 0) {
      world.effects.push({ kind: 'explosion', x: target.pos.x, y: target.pos.y, radius, ttl: 14 })
      for (const other of world.actors.values()) {
        if (!other.alive || other.team === projectile.team || other.id === target.id || distance(other.pos, target.pos) > radius + other.radius) continue
        applyDamage(world, { targetId: other.id, sourceId: projectile.ownerId, sourceTeam: projectile.team, raw: projectile.damage, penetration: projectile.penetration, isCore: false, kind: 'bullet' })
      }
    }
    projectile.hitIds.push(target.id); projectile.pierceLeft -= isCore ? 2 : 1
    if (projectile.pierceLeft <= 0) return 'stopped'
  }
  return 'alive'
}
function tryDeflect(world: World, projectile: Projectile, target: Actor): boolean {
  if (projectile.team === target.team || target.deflectWindowTicks <= 0 || target.attrs.deflectLevel <= 0) return false
  projectile.team = target.team; projectile.ownerId = target.id; projectile.hitIds.length = 0
  projectile.targetId = target.lockTargetId; projectile.travelLeft = Math.max(projectile.travelLeft, 500)
  projectile.vel = { x: -projectile.vel.x, y: -projectile.vel.y }
  let kind: EffectKind = 'deflect'
  if (target.attrs.deflectLevel >= 2) { projectile.damage *= target.attrs.reflectDamageMult; kind = 'reflect' }
  world.effects.push({ kind, x: projectile.pos.x, y: projectile.pos.y, radius: 34, ttl: 14 })
  return true
}
