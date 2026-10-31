import { combatAttrs } from '../combat'
import { clamp } from '../math'
import type { Rect } from '../types'
import { TICK_DT } from '../types'
import type { Actor, World } from '../world'

/** Step 4 of the tick order (see docs/architecture.md 5.4). */
export function updateMovement(world: World, dt: number = TICK_DT): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue
    const raw = actor.dashTicks > 0 ? actor.dashDirection : actor.intent.move
    const magnitude = Math.max(1, Math.hypot(raw.x, raw.y))
    const dir = { x: raw.x / magnitude, y: raw.y / magnitude }
    if (dir.x === 0 && dir.y === 0) continue

    const distance = combatAttrs(actor).speed * dt
    const steps = Math.max(1, Math.ceil(distance / Math.max(4, actor.radius * 0.5)))
    for (let i = 0; i < steps; i++) {
      const before = actor.pos
      moveActor(world, actor, dir.x * distance / steps, dir.y * distance / steps)
      if (before.x === actor.pos.x && before.y === actor.pos.y) break
    }
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

export function separateActors(world: World): void {
  const actors = [...world.actors.values()].filter((actor) => actor.alive)
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
    const a = actors[i]!, b = actors[j]!
    if (a.team === 'player' && b.team === 'player') continue
    let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y
    const length = Math.hypot(dx, dy), overlap = a.radius + b.radius - length
    if (overlap <= 0) continue
    if (length < 0.001) { const angle = (a.id * 13 + b.id * 7) * 0.7; dx = Math.cos(angle); dy = Math.sin(angle) }
    else { dx /= length; dy /= length }
    const pushA = (world.participants || a.team !== 'player') && a.attrs.speed > 0, pushB = (world.participants || b.team !== 'player') && b.attrs.speed > 0
    const count = Number(pushA) + Number(pushB)
    if (!count) continue
    const amount = Math.min(8, overlap * 0.4) / count
    if (pushA) moveActor(world, a, -dx * amount, -dy * amount)
    if (pushB) moveActor(world, b, dx * amount, dy * amount)
  }
}
