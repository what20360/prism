import { shieldCap } from './attrs'
import type { RoomTemplate, World } from './world'
import { createActor, getPlayer } from './world'

export type RoomSpec = RoomTemplate

/**
 * Switches the world to another room: clears transient entities, repositions the
 * player (keeping all progression) and spawns the new enemy set.
 */
export function applyRoom(world: World, room: RoomSpec): void {
  for (const [id, actor] of world.actors) {
    if (actor.team === 'enemy') world.actors.delete(id)
  }

  world.projectiles = []
  world.mines = []
  world.effects = []

  world.room.kind = room.kind
  world.room.walls = room.walls
  world.room.phase = 'combat'
  world.room.exit = null
  world.roomCleared = false
  world.playerTookHit = false
  world.exitReached = false

  const player = getPlayer(world)
  player.pos = room.entry
  player.iframesTicks = 0
  player.deflectWindowTicks = 0
  player.shield = Math.min(player.shield, shieldCap(player.attrs))

  for (const spawn of room.spawns) {
    createActor(world, { team: 'enemy', ...spawn })
  }
}