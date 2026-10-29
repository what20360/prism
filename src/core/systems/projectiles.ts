import { circleIntersectsRect, distance } from '../collision'
import type { Projectile, World } from '../world'

/** Step 6: move projectiles, expire on range, stop at walls. */
export function updateProjectiles(world: World, dt: number): void {
  const survivors: Projectile[] = []

  for (const projectile of world.projectiles) {
    const speed = Math.hypot(projectile.vel.x, projectile.vel.y)
    const slow = slowMultiplier(world, projectile)
    const travel = speed * slow * dt

    projectile.prevPos = projectile.pos

    if (speed > 0) {
      projectile.pos = {
        x: projectile.pos.x + (projectile.vel.x / speed) * travel,
        y: projectile.pos.y + (projectile.vel.y / speed) * travel,
      }
    }

    projectile.travelLeft -= travel
    if (projectile.travelLeft <= 0) continue
    if (hitsWall(world, projectile)) continue

    survivors.push(projectile)
  }

  world.projectiles = survivors
}

/** Opposing mines slow bullets inside their field; strongest slow wins. */
function slowMultiplier(world: World, projectile: Projectile): number {
  let factor = 1
  for (const mine of world.mines) {
    if (mine.team === projectile.team) continue
    if (distance(mine.pos, projectile.pos) > mine.slowRadius) continue
    if (mine.slowFactor < factor) factor = mine.slowFactor
  }
  return factor
}

function hitsWall(world: World, projectile: Projectile): boolean {
  const { bounds, walls } = world.room
  const { x, y } = projectile.pos
  const r = projectile.radius

  if (x - r < bounds.x || x + r > bounds.x + bounds.width) return true
  if (y - r < bounds.y || y + r > bounds.y + bounds.height) return true

  for (const wall of walls) {
    if (circleIntersectsRect(x, y, r, wall)) return true
  }
  return false
}
