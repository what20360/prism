import type { Rect, Team, Vec2 } from './types'

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function circleIntersectsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = x < rect.x ? rect.x : x > rect.x + rect.width ? rect.x + rect.width : x
  const nearestY = y < rect.y ? rect.y : y > rect.y + rect.height ? rect.y + rect.height : y
  const dx = x - nearestX
  const dy = y - nearestY
  return dx * dx + dy * dy < radius * radius
}

export function isOpposing(a: Team, b: Team): boolean {
  return a !== b
}

/**
 * Nudges a circle out of every wall it overlaps and back inside the room bounds.
 * Spawning uses this so a content anchor can never trap an actor in geometry.
 */
export function resolveSpawnPosition(
  pos: Vec2,
  radius: number,
  walls: readonly Rect[],
  bounds: Rect,
): Vec2 {
  let x = pos.x
  let y = pos.y

  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false
    for (const wall of walls) {
      if (!circleIntersectsRect(x, y, radius, wall)) continue

      const left = wall.x - radius - x
      const right = wall.x + wall.width + radius - x
      const up = wall.y - radius - y
      const down = wall.y + wall.height + radius - y
      const dx = Math.abs(left) < Math.abs(right) ? left : right
      const dy = Math.abs(up) < Math.abs(down) ? up : down

      if (Math.abs(dx) <= Math.abs(dy)) x += dx
      else y += dy
      moved = true
    }
    if (!moved) break
  }

  const minX = bounds.x + radius
  const maxX = bounds.x + bounds.width - radius
  const minY = bounds.y + radius
  const maxY = bounds.y + bounds.height - radius
  return {
    x: x < minX ? minX : x > maxX ? maxX : x,
    y: y < minY ? minY : y > maxY ? maxY : y,
  }
}

/** Shortest distance from a point to a ray (origin + unit direction). */
export function distanceToRay(
  px: number,
  py: number,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
): number {
  const forward = (px - ox) * dx + (py - oy) * dy
  if (forward <= 0) return Math.hypot(px - ox, py - oy)
  return Math.abs((px - ox) * dy - (py - oy) * dx)
}
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy

  if (lengthSq === 0) return Math.hypot(px - ax, py - ay)

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
