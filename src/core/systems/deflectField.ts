import type { World } from '../world'

/** The active skill multiplies the field, so it visibly "pushes harder". */
export const ACTIVE_FIELD_MULTIPLIER = 5

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

      const falloff = 1 - distance / radius
      const push = strength * falloff * falloff * dt

      projectile.vel = {
        x: projectile.vel.x + (dx / distance) * push,
        y: projectile.vel.y + (dy / distance) * push,
      }
    }
  }
}
