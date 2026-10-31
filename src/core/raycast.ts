import type { Vec2 } from './types'
/** First intersection with a circle, including shots starting inside it. */
export function circleEntry(from: Vec2, to: Vec2, centre: Vec2, radius: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y, x = from.x - centre.x, y = from.y - centre.y
  const c = x * x + y * y - radius * radius
  if (c <= 0) return 0
  const a = dx * dx + dy * dy
  if (a < 1e-12) return null
  const b = 2 * (x * dx + y * dy), d = b * b - 4 * a * c
  if (d < 0) return null
  const t = (-b - Math.sqrt(d)) / (2 * a)
  return t >= 0 && t <= 1 ? t : null
}
