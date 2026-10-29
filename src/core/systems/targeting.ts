import { distance } from '../collision'
import type { Actor, World } from '../world'
import type { EntityId } from '../types'

export function nearestOpponent(world: World, actor: Actor, maxRange: number): Actor | undefined {
  let best: Actor | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of world.actors.values()) {
    if (!candidate.alive || candidate.team === actor.team) continue
    const d = distance(actor.pos, candidate.pos)
    if (d <= maxRange && d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }

  return best
}

export function opponentsOf(world: World, team: Actor['team']): Actor[] {
  const result: Actor[] = []
  for (const actor of world.actors.values()) {
    if (actor.alive && actor.team !== team) result.push(actor)
  }
  return result
}

export function isAlive(world: World, id: EntityId): boolean {
  const actor = world.actors.get(id)
  return actor !== undefined && actor.alive
}
