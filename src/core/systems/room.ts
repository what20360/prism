import { distance } from '../collision'
import type { Rect } from '../types'
import type { World } from '../world'
import { tryGetPlayer } from '../world'

/** Exit sits at the top-centre of every non-boss room. */
export const EXIT_RECT: Rect = { x: 1480, y: 60, width: 240, height: 140 }

/** Step 11: room clear opens the exit; resources only spawn on room entry. */
export function updateRoom(world: World): void {
  if (world.roomCleared) return
  if (world.room.phase === 'entered') return

  for (const actor of world.actors.values()) {
    if (actor.alive && actor.team === 'enemy') return
  }

  world.roomCleared = true
  world.room.phase = 'cleared'

  // The boss room ends the run instead of opening a door.
  if (world.room.kind === 'boss') {
    world.victory = true
    return
  }

  world.room.exit = EXIT_RECT
}

/** Closest enemy distance (Infinity when none) - handy for tests and tools. */
export function nearestEnemyDistance(world: World): number {
  const player = tryGetPlayer(world)
  if (!player) return Number.POSITIVE_INFINITY

  let best = Number.POSITIVE_INFINITY
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team !== 'enemy') continue
    best = Math.min(best, distance(actor.pos, player.pos))
  }
  return best
}
