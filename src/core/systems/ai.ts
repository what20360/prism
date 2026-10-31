import { circleIntersectsRect, resolveSpawnPosition } from '../collision'
import { normalize } from '../math'
import { findPath, hasLineOfSight } from '../navigation'
import type { World } from '../world'
import { tryGetPlayer } from '../world'
export function updateAi(world: World, controlled: ReadonlySet<number> = new Set()): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === 'player' || controlled.has(actor.id)) continue
    const player = world.participants ? [...world.actors.values()].filter((a) => a.alive && world.participants![a.id] && a.team !== actor.team)
      .sort((a, b) => Math.hypot(a.pos.x - actor.pos.x, a.pos.y - actor.pos.y) - Math.hypot(b.pos.x - actor.pos.x, b.pos.y - actor.pos.y) || a.id - b.id)[0] : tryGetPlayer(world)
    if (!player) { actor.intent = { move: { x: 0, y: 0 }, fire: false }; continue }
    if (world.room.walls.some((wall) => circleIntersectsRect(actor.pos.x, actor.pos.y, actor.radius, wall))) {
      actor.pos = resolveSpawnPosition(actor.pos, actor.radius, world.room.walls, world.room.bounds); actor.navTimer = 0
    }
    const visible = hasLineOfSight(actor.pos, player.pos, world.room.walls)
    let move = { x: 0, y: 0 }
    if (actor.behavior !== 'turret' && actor.attrs.speed > 0) {
      if (hasLineOfSight(actor.pos, player.pos, world.room.walls, actor.radius)) actor.navPath = [player.pos]
      else if (actor.navTimer <= 0 || Math.hypot(player.pos.x - actor.navGoal.x, player.pos.y - actor.navGoal.y) > 120) {
        actor.navPath = findPath(world.room, actor.pos, player.pos, actor.radius)
        actor.navGoal = { ...player.pos }; actor.navTimer = 24 + actor.id % 9
      }
      actor.navTimer -= 1
      while (actor.navPath.length > 1 && hasLineOfSight(actor.pos, actor.navPath[1]!, world.room.walls, actor.radius)) actor.navPath.shift()
      const goal = actor.navPath[0]
      if (goal) move = normalize({ x: goal.x - actor.pos.x, y: goal.y - actor.pos.y })
    }
    const lead = visible ? Math.min(0.25, Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) / Math.max(1, actor.attrs.bulletSpeed)) : 0
    actor.intent = { move, fire: actor.behavior === 'boss' || (visible && Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) <= actor.attrs.range),
      aim: normalize({ x: player.pos.x + player.intent.move.x * player.attrs.speed * lead - actor.pos.x,
        y: player.pos.y + player.intent.move.y * player.attrs.speed * lead - actor.pos.y }) }
  }
}
