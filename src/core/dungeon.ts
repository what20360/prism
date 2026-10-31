import { shieldCap } from './attrs'
import type { RoomTemplate, World } from './world'
import { getPlayer, spawnEnemy, configureRoomWaves } from './world'
import { populateRoomPickups } from './roomResources'

export type RoomSpec = RoomTemplate

/** Player must move this far from the entry before the room starts spawning. */
export const ROOM_ACTIVATION_RADIUS = 140

/**
 * Switches the world to another room: clears transient entities, repositions the
 * player (keeping all progression) and queues the enemy set. Enemies are spawned
 * by `updateRoomEntry` once the player actually steps into the room.
 */
export function applyRoom(world: World, room: RoomSpec): void {
  for (const [id, actor] of world.actors) {
    if (actor.team === 'enemy') world.actors.delete(id)
  }

  world.projectiles = []
  world.mines = []
  world.pickups = []
  world.effects = []

  world.room.kind = room.kind
  world.room.walls = room.walls
  world.room.entry = room.entry
  world.room.phase = 'entered'
  world.room.exit = null
  world.roomCleared = false
  world.playerTookHit = false
  world.exitReached = false
  world.pendingSpawns = [...room.spawns]
  configureRoomWaves(world, room)

  const player = getPlayer(world)
  player.pos = room.entry
  player.iframesTicks = 0
  player.deflectWindowTicks = 0
  player.lockTargetId = null; player.manualLockId = null
  player.burstRemaining = 0; player.rageTicks = 0; player.dashTicks = 0
  player.shield = Math.min(player.shield, shieldCap(player.attrs))
  populateRoomPickups(world, room.pickups)
}

export function spawnPendingEnemies(world: World): void {
  for (const spawn of world.pendingSpawns) {
    spawnEnemy(world, spawn)
  }
  world.pendingSpawns = []
}
