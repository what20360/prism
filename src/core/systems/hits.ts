import { distance, distanceToRay } from '../collision'
import type { Actor, EffectKind, Projectile, World } from '../world'
import { applyDamage } from './damage'
import { firstMineBodyHit, removeMine } from './mines'

/** Step 7: bullet vs mine body, then bullet vs actor (with double-layer check). */
export function resolveHits(world: World): void {
  const survivors: Projectile[] = []

  for (const projectile of world.projectiles) {
    const mine = firstMineBodyHit(world, projectile)
    if (mine) {
      mine.hp -= projectile.damage
      if (mine.hp <= 0) removeMine(world, mine)
      continue
    }

    const target = firstActorHit(world, projectile)
    if (target) {
      if (tryDeflect(world, projectile, target)) {
        survivors.push(projectile)
        continue
      }

      const coreRadius = target.hasCore ? target.radius * target.attrs.coreRadiusMult : 0
      // A bullet stops at the outer shell, so the inner core is only reachable
      // when the shot is aimed through it AND a pierce layer remains (docs 5.6.1).
      const isCore =
        coreRadius > 0 && projectile.pierceLeft >= 2 && aimedAt(target, projectile, coreRadius)
      if (isCore) world.stats.coreHits += 1

      applyDamage(world, {
        targetId: target.id,
        sourceId: projectile.ownerId,
        sourceTeam: projectile.team,
        raw: projectile.damage * (isCore ? projectile.innerMult : 1),
        penetration: projectile.penetration,
        isCore,
      })

      projectile.hitIds.push(target.id)
      projectile.pierceLeft -= isCore ? 2 : 1
      if (projectile.pierceLeft <= 0) continue
    }

    survivors.push(projectile)
  }

  world.projectiles = survivors
}

/** Deflection: passive charge spends on a side turn, active window converts ownership. */
function tryDeflect(world: World, projectile: Projectile, target: Actor): boolean {
  if (projectile.team === target.team) return false

  if (target.deflectWindowTicks > 0 && target.attrs.deflectLevel > 0) {
    projectile.team = target.team
    projectile.ownerId = target.id
    projectile.hitIds.length = 0
    projectile.travelLeft = Math.max(projectile.travelLeft, 500)
    projectile.vel = { x: -projectile.vel.x, y: -projectile.vel.y }

    let kind: EffectKind = 'deflect'
    if (target.attrs.deflectLevel >= 2) {
      projectile.damage *= target.attrs.reflectDamageMult
      kind = 'reflect'
    }

    world.effects.push({ kind, x: projectile.pos.x, y: projectile.pos.y, radius: 34, ttl: 14 })
    return true
  }

  if (target.attrs.passiveDeflectRate > 0 && target.deflectCharge >= 1) {
    target.deflectCharge -= 1
    projectile.vel = { x: -projectile.vel.y, y: projectile.vel.x }
    world.effects.push({ kind: 'deflect', x: projectile.pos.x, y: projectile.pos.y, radius: 30, ttl: 12 })
    return true
  }

  return false
}

/** True when the shot's flight line passes within `radius` of the target centre. */
function aimedAt(target: Actor, projectile: Projectile, radius: number): boolean {
  const dx = projectile.pos.x - projectile.prevPos.x
  const dy = projectile.pos.y - projectile.prevPos.y
  const length = Math.hypot(dx, dy)
  const dirX = length > 0 ? dx / length : 1
  const dirY = length > 0 ? dy / length : 0

  return distanceToRay(target.pos.x, target.pos.y, projectile.prevPos.x, projectile.prevPos.y, dirX, dirY) <= radius
}

function firstActorHit(world: World, projectile: Projectile): Actor | undefined {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue
    if (actor.team === projectile.team) continue
    if (projectile.hitIds.includes(actor.id)) continue
    if (distance(projectile.pos, actor.pos) <= projectile.radius + actor.radius) return actor
  }
  return undefined
}