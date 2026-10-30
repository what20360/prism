import type { World } from '../world'
import { DEFLECT_RULES } from '../rules'

/** The active skill multiplies the field, so it visibly "pushes harder". */
export const ACTIVE_FIELD_MULTIPLIER = DEFLECT_RULES.activeForceMultiplier

/**
 * Continuous deflection field around an actor (docs/requirements.md 5.7.4).
 *
 * Every tick each hostile projectile inside the field gets an outward push
 * proportional to (1 - distance/radius)^2, i.e. the closer it is, the faster
 * its velocity changes. This bends trajectories instead of hard-blocking them,
 * so fast bullets still get through if they are aimed well enough.
 */
export function updateDeflectFields(world: World, dt: number): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue

    const radius = actor.attrs.deflectFieldRadius
    if (radius <= 0) continue

    const active = actor.deflectWindowTicks > 0 && actor.attrs.deflectLevel > 0
    const strength = actor.attrs.deflectFieldStrength * (active ? ACTIVE_FIELD_MULTIPLIER : 1)
    if (strength <= 0) continue

    for (const projectile of world.projectiles) {
      if (projectile.team === actor.team) continue

      const dx = projectile.pos.x - actor.pos.x
      const dy = projectile.pos.y - actor.pos.y
      const distance = Math.hypot(dx, dy)
      if (distance > radius || distance === 0) continue

      if (active) {
        const cap = actor.attrs.maxProjectiles
        const owned = world.projectiles.filter((p) => p.ownerId === actor.id && p.team === actor.team && p.pierceLeft > 0).length
        if (cap > 0 && owned >= cap) { projectile.pierceLeft = 0; continue }
        projectile.team = actor.team; projectile.ownerId = actor.id; projectile.hitIds.length = 0
        projectile.targetId = actor.lockTargetId; projectile.travelLeft = Math.max(500, projectile.travelLeft)
        const rebound = strength * (1 - distance / radius) ** 2 * dt
        projectile.vel = { x: -projectile.vel.x + dx / distance * rebound, y: -projectile.vel.y + dy / distance * rebound }
        if (actor.attrs.deflectLevel >= 2) projectile.damage *= actor.attrs.reflectDamageMult
        world.effects.push({ kind: actor.attrs.deflectLevel >= 2 ? 'reflect' : 'deflect', x: projectile.pos.x, y: projectile.pos.y, radius: 30, ttl: 12 })
        continue
      }
      const falloff = 1 - distance / radius
      const push = strength * falloff * falloff * dt

      projectile.vel = {
        x: projectile.vel.x + (dx / distance) * push,
        y: projectile.vel.y + (dy / distance) * push,
      }
    }
  }
  world.projectiles = world.projectiles.filter((projectile) => projectile.pierceLeft > 0)
}
