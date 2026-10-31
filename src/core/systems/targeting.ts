import { distance } from '../collision'
import { hasLineOfSight } from '../navigation'
import type { Actor, World } from '../world'
import type { EntityId } from '../types'
export function nearestOpponent(world: World, actor: Actor, maxRange: number): Actor | undefined {
  return opponentsOf(world, actor.team).filter((other) => distance(other.pos, actor.pos) <= maxRange && hasLineOfSight(actor.pos, other.pos, world.room.walls))
    .sort((a, b) => distance(a.pos, actor.pos) - distance(b.pos, actor.pos) || a.id - b.id)[0]
}
export function updateTargetLocks(world: World): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive) continue
    const valid = (id: number | null | undefined) => {
      const target = id == null ? undefined : world.actors.get(id)
      return target?.alive && target.team !== actor.team ? target : undefined
    }
    if (actor.intent.lockTarget !== undefined) actor.manualLockId = valid(actor.intent.lockTarget)?.id ?? null
    const pinned = valid(actor.manualLockId)
    if (pinned) { actor.lockTargetId = pinned.id; continue }
    actor.manualLockId = null
    if (actor.team !== 'player' && !world.participants?.[actor.id]) { actor.lockTargetId = nearestOpponent(world, actor, actor.attrs.range || Infinity)?.id ?? null; continue }
    const aim = actor.intent.aim ?? { x: Math.cos(actor.aimAngle), y: Math.sin(actor.aimAngle) }, angle = Math.atan2(aim.y, aim.x)
    const candidates = opponentsOf(world, actor.team).map((target) => {
      const offset = Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x) - angle
      return { target, difference: Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset))), distance: distance(target.pos, actor.pos) }
    }).filter((entry) => entry.difference <= Math.PI / 3 && entry.distance <= Math.max(actor.attrs.range, 900) && hasLineOfSight(actor.pos, entry.target.pos, world.room.walls))
    candidates.sort((a, b) => (a.difference - (a.target.id === actor.lockTargetId ? 0.08 : 0)) - (b.difference - (b.target.id === actor.lockTargetId ? 0.08 : 0)) || a.distance - b.distance || a.target.id - b.target.id)
    actor.lockTargetId = candidates[0]?.target.id ?? null
  }
}
export function opponentsOf(world: World, team: Actor['team']): Actor[] { return [...world.actors.values()].filter((actor) => actor.alive && actor.team !== team) }
export function isAlive(world: World, id: EntityId): boolean { return world.actors.get(id)?.alive === true }
