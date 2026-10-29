import type { World } from '../world'

/** Step 11: room clear grants the guaranteed income. */
export function updateRoom(world: World): void {
  if (world.roomCleared) return

  for (const actor of world.actors.values()) {
    if (actor.alive && actor.team === 'enemy') return
  }

  world.roomCleared = true
  world.room.phase = 'cleared'

  const bonus = world.playerTookHit
    ? world.economy.roomClear
    : world.economy.roomClear + world.economy.roomClearNoHit
  world.shards += bonus
}
