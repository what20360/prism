import { distance } from '../collision'
import { firstWallHit } from '../navigation'
import type { Projectile, World } from '../world'
import { resolveProjectilePath } from './hits'

export function slowDivisor(world: World, projectile: Projectile): number {
  let divisor = 1
  for (const mine of world.mines) {
    if (mine.team === projectile.team || distance(mine.pos, projectile.pos) > mine.slowRadius) continue
    divisor = Math.max(divisor, mine.slowMultiplier)
  }
  return divisor
}
export function updateProjectiles(world: World, dt: number): void {
  const survivors: Projectile[] = []
  for (const projectile of world.projectiles) {
    projectile.prevPos = { ...projectile.pos }
    projectile.trail ??= []; projectile.trail.push({ ...projectile.pos }); if (projectile.trail.length > 9) projectile.trail.shift()
    steer(world, projectile, dt)
    let travel = Math.min(projectile.travelLeft, Math.hypot(projectile.vel.x, projectile.vel.y) / slowDivisor(world, projectile) * dt)
    let alive = true, reflected = false
    if (travel <= 0.00001) {
      const result = resolveProjectilePath(world, projectile, projectile.pos, projectile.pos)
      alive = result !== 'stopped'; reflected = result === 'reflected'
    }
    for (let bounce = 0; travel > 0.00001 && alive && bounce < 64; bounce++) {
      const speed = Math.hypot(projectile.vel.x, projectile.vel.y)
      if (!speed) break
      const from = { ...projectile.pos }, direction = { x: projectile.vel.x / speed, y: projectile.vel.y / speed }
      const to = { x: from.x + direction.x * travel, y: from.y + direction.y * travel }
      const wall = firstWallHit(world.room, from, to, projectile.radius)
      const portion = wall ? Math.max(0, wall.t) : 1
      const end = { x: from.x + (to.x - from.x) * portion, y: from.y + (to.y - from.y) * portion }
      projectile.pos = end
      const result = resolveProjectilePath(world, projectile, from, end)
      const spent = travel * portion
      projectile.travelLeft -= spent; travel -= spent
      if (result === 'stopped') { projectile.pierceLeft = 0; alive = false; break }
      if (result === 'reflected') { reflected = true; break }
      if (!wall) break
      if (!projectile.ricochet || projectile.pierceLeft <= 1) { projectile.pierceLeft = 0; alive = false; break }
      projectile.pierceLeft -= 1
      projectile.vel = { x: wall.nx ? -projectile.vel.x : projectile.vel.x, y: wall.ny ? -projectile.vel.y : projectile.vel.y }
      projectile.pos = { x: end.x + wall.nx * 0.01, y: end.y + wall.ny * 0.01 }
      projectile.trail.push({ ...projectile.pos }); if (projectile.trail.length > 9) projectile.trail.shift()
    }
    projectile.resolvedTick = world.tick
    if (alive && (projectile.travelLeft > 0 || reflected)) survivors.push(projectile)
  }
  world.projectiles = survivors
}
function steer(world: World, projectile: Projectile, dt: number): void {
  if (!projectile.homingTurn) return
  const owner = world.actors.get(projectile.ownerId)
  if (owner?.alive) projectile.targetId = owner.lockTargetId
  const target = projectile.targetId == null ? undefined : world.actors.get(projectile.targetId)
  const current = Math.atan2(projectile.vel.y, projectile.vel.x)
  let angle = current
  if (target?.alive && target.team !== projectile.team) {
    const desired = Math.atan2(target.pos.y - projectile.pos.y, target.pos.x - projectile.pos.x)
    const difference = Math.atan2(Math.sin(desired - current), Math.cos(desired - current))
    angle += Math.max(-projectile.homingTurn * dt, Math.min(projectile.homingTurn * dt, difference))
  }
  const speed = Math.min(projectile.cruiseSpeed ?? Infinity, Math.hypot(projectile.vel.x, projectile.vel.y) + 250 * dt)
  projectile.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
}
