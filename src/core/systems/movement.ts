import { clamp, normalize } from '../math'
import type { Rect } from '../types'
import { TICK_DT } from '../types'
import type { Actor, World } from '../world'

/** Step 4 of the tick order (see docs/architecture.md 5.4). */
export function updateMovement(world: World, dt: number = TICK_DT): void {
  for (const actor of world.actors.values()) {
    const dir = normalize(actor.intent.move)
    if (dir.x === 0 && dir.y === 0) continue

    const distance = actor.attrs.speed * dt
    moveActor(world, actor, dir.x * distance, dir.y * distance)
  }
}

/**
 * Axis-separated movement: each axis is applied then reverted on collision,
 * which gives free wall sliding without a physics engine.
 */
function moveActor(world: World, actor: Actor, dx: number, dy: number): void {
  const { bounds, walls } = world.room
  const r = actor.radius
  let { x, y } = actor.pos

  if (dx !== 0) {
    const nextX = clamp(x + dx, bounds.x + r, bounds.x + bounds.width - r)
    if (!collidesAny(nextX, y, r, walls)) x = nextX
  }

  if (dy !== 0) {
    const nextY = clamp(y + dy, bounds.y + r, bounds.y + bounds.height - r)
    if (!collidesAny(x, nextY, r, walls)) y = nextY
  }

  actor.pos = { x, y }
}

export function collidesAny(x: number, y: number, radius: number, walls: readonly Rect[]): boolean {
  for (const wall of walls) {
    if (circleIntersectsRect(x, y, radius, wall)) return true
  }
  return false
}

export function circleIntersectsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = clamp(x, rect.x, rect.x + rect.width)
  const nearestY = clamp(y, rect.y, rect.y + rect.height)
  const dx = x - nearestX
  const dy = y - nearestY
  return dx * dx + dy * dy < radius * radius
}
