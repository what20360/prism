import { normalize } from '../math'
import { findPath, hasLineOfSight } from '../navigation'
import type { World } from '../world'
import { tryGetPlayer } from '../world'
export function updateAi(world: World): void {
  const player = tryGetPlayer(world)
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team !== 'enemy') continue
    if (!player) { actor.intent = { move: { x: 0, y: 0 }, fire: false }; continue }
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
      while (actor.navPath.length > 1 && Math.hypot(actor.navPath[0]!.x - actor.pos.x, actor.navPath[0]!.y - actor.pos.y) < 16) actor.navPath.shift()
      const goal = actor.navPath[0]
      if (goal) move = normalize({ x: goal.x - actor.pos.x, y: goal.y - actor.pos.y })
    }
    const lead = visible ? Math.min(0.25, Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) / Math.max(1, actor.attrs.bulletSpeed)) : 0
    actor.intent = { move, fire: actor.behavior === 'boss' || (visible && Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) <= actor.attrs.range),
      aim: normalize({ x: player.pos.x + player.intent.move.x * player.attrs.speed * lead - actor.pos.x,
        y: player.pos.y + player.intent.move.y * player.attrs.speed * lead - actor.pos.y }) }
  }
}
