import { distance } from '../collision'
import { ROOM_ACTIVATION_RADIUS, spawnPendingEnemies } from '../dungeon'
import type { World } from '../world'
import { tryGetPlayer } from '../world'

/**
 * A room starts its fight only after the player walks in (requirements 6.5):
 * enemies are queued on transition and spawned once the player leaves the
 * entry area, so nobody gets shot the instant they appear.
 */
export function updateRoomEntry(world: World): void {
  if (world.room.phase !== 'entered') return

  const player = tryGetPlayer(world)
  const steppedIn = !player || distance(player.pos, world.room.entry) > ROOM_ACTIVATION_RADIUS

  if (!steppedIn) return

  spawnPendingEnemies(world)
  world.room.phase = 'combat'
}
