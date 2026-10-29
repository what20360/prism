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
