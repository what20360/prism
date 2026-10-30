import type { Intent } from './controller'
import { updateAi } from './systems/ai'
import { updateBoss } from './systems/boss'
import { resolveContactDamage } from './systems/damage'
import { updateDeflectFields } from './systems/deflectField'
import { updateRoomEntry } from './systems/entry'
import { updateExit } from './systems/exit'
import { resolveHits } from './systems/hits'
import { tryPlaceMine, updateMines } from './systems/mines'
import { updateMovement } from './systems/movement'
import { updateProjectiles } from './systems/projectiles'
import { updateRoom } from './systems/room'
import { tryActivateDeflect } from './systems/skills'
import { updateTimers } from './systems/timers'
import { updateWeapons } from './systems/weapons'
import type { EntityId } from './types'
import { TICK_DT } from './types'
import type { World } from './world'

/**
 * Advances the world by exactly one fixed tick.
 * Stage numbering follows docs/architecture.md 5.4; order is behaviour.
 */
export function step(world: World, intents: ReadonlyMap<EntityId, Intent>): void {
  if (world.gameOver || world.paused) return

  // 1-2. collect and apply intents
  for (const [id, intent] of intents) {
    const actor = world.actors.get(id)
    if (!actor || !actor.alive) continue
    actor.intent = intent
    if (intent.placeMine) tryPlaceMine(world, actor)
    if (intent.skill === 0) tryActivateDeflect(world, actor)
  }

  // 3. timers
  updateTimers(world)

  // 3.5 rooms only start spawning once the player steps in
  updateRoomEntry(world)

  // 4. movement (AI authors intents for its own actors)
  updateAi(world)
  updateMovement(world, TICK_DT)

  // 5. weapons
  updateWeapons(world)

  // 5.5 deflection fields bend hostile bullets before they move
  updateDeflectFields(world, TICK_DT)

  // 5.6 boss phase changes and bullet-clearing pulses
  updateBoss(world)

  // 6. projectiles
  updateProjectiles(world, TICK_DT)

  // 7. hits
  resolveHits(world)
  resolveContactDamage(world)

  // 8. mines
  updateMines(world)

  // 11. room state
  updateRoom(world)
  updateExit(world)

  world.tick += 1
}