import { normalize } from '../math'
import type { World } from '../world'
import { tryGetPlayer } from '../world'

/**
 * Enemy controllers produce the same Intent a player does, so both sides run
 * through one simulation path (see docs/architecture.md 9.5).
 */
export function updateAi(world: World): void {
  const player = tryGetPlayer(world)

  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team !== 'enemy') continue

    if (!player || actor.behavior === 'turret') {
      actor.intent = { move: { x: 0, y: 0 } }
      continue
    }

    actor.intent = {
      move: normalize({
        x: player.pos.x - actor.pos.x,
        y: player.pos.y - actor.pos.y,
      }),
    }
  }
}
