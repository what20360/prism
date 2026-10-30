import type { Rect, Vec2 } from './types'
import type { RoomState } from './world'
export interface WallHit { t: number; nx: number; ny: number }
export function segmentRect(from: Vec2, to: Vec2, rect: Rect, padding = 0): WallHit | null {
  let enter = 0, leave = 1, nx = 0, ny = 0
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis], lo = rect[axis] - padding
    const hi = lo + (axis === 'x' ? rect.width : rect.height) + padding * 2
    if (Math.abs(delta) < 1e-9) { if (from[axis] < lo || from[axis] > hi) return null; continue }
    let near = (lo - from[axis]) / delta, far = (hi - from[axis]) / delta
    const sign = delta > 0 ? -1 : 1
    if (near > far) [near, far] = [far, near]
    if (near > enter) { enter = near; nx = axis === 'x' ? sign : 0; ny = axis === 'y' ? sign : 0 }
    if (far < leave) leave = far
    if (enter > leave) return null
  }
  if (leave < 0 || enter > 1) return null
  return { t: Math.max(0, enter), nx: nx || (ny ? 0 : -Math.sign(to.x - from.x)), ny }
}
export function firstWallHit(room: Pick<RoomState, 'bounds' | 'walls'>, from: Vec2, to: Vec2, radius: number): WallHit | null {
  let best: WallHit | null = null
  const consider = (hit: WallHit | null) => { if (hit && (!best || hit.t < best.t)) best = hit }
  for (const wall of room.walls) consider(segmentRect(from, to, wall, radius))
  const b = room.bounds, dx = to.x - from.x, dy = to.y - from.y
  if (to.x < b.x + radius && dx < 0) consider({ t: Math.max(0, (b.x + radius - from.x) / dx), nx: 1, ny: 0 })
  if (to.x > b.x + b.width - radius && dx > 0) consider({ t: Math.max(0, (b.x + b.width - radius - from.x) / dx), nx: -1, ny: 0 })
  if (to.y < b.y + radius && dy < 0) consider({ t: Math.max(0, (b.y + radius - from.y) / dy), nx: 0, ny: 1 })
  if (to.y > b.y + b.height - radius && dy > 0) consider({ t: Math.max(0, (b.y + b.height - radius - from.y) / dy), nx: 0, ny: -1 })
  return best
}
export function hasLineOfSight(from: Vec2, to: Vec2, walls: readonly Rect[], radius = 0): boolean {
  return !walls.some((wall) => segmentRect(from, to, wall, radius))
}
/** Deterministic visibility graph around inflated wall corners. */
export function findPath(room: Pick<RoomState, 'walls' | 'bounds'>, from: Vec2, goal: Vec2, radius: number): Vec2[] {
  if (hasLineOfSight(from, goal, room.walls, radius)) return [goal]
  const margin = radius + 6, b = room.bounds, nodes: Vec2[] = [from, goal]
  for (const wall of room.walls) for (const x of [wall.x - margin, wall.x + wall.width + margin]) for (const y of [wall.y - margin, wall.y + wall.height + margin]) {
    if (x < b.x + radius || x > b.x + b.width - radius || y < b.y + radius || y > b.y + b.height - radius) continue
    if (room.walls.some((w) => x > w.x - radius && x < w.x + w.width + radius && y > w.y - radius && y < w.y + w.height + radius)) continue
    nodes.push({ x, y })
  }
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), closed = new Set<number>()
  costs[0] = 0
  for (let round = 0; round < nodes.length; round++) {
    let current = -1
    for (let i = 0; i < nodes.length; i++) if (!closed.has(i) && (current < 0 || costs[i]! < costs[current]!)) current = i
    if (current < 0 || !Number.isFinite(costs[current]!)) break
    if (current === 1) { const path: Vec2[] = []; for (let index = 1; index > 0; index = previous[index]!) path.unshift(nodes[index]!); return path }
    closed.add(current)
    for (let i = 0; i < nodes.length; i++) {
      if (closed.has(i) || !hasLineOfSight(nodes[current]!, nodes[i]!, room.walls, radius)) continue
      const cost = costs[current]! + Math.hypot(nodes[i]!.x - nodes[current]!.x, nodes[i]!.y - nodes[current]!.y)
      if (cost < costs[i]!) { costs[i] = cost; previous[i] = current }
    }
  }
  return []
}
