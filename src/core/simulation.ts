import type { Intent } from './controller'
import { updateMovement } from './systems/movement'
import type { EntityId } from './types'
import { TICK_DT } from './types'
import type { World } from './world'

/**
 * Advances the world by exactly one fixed tick.
 *
 * The full tick order is documented in docs/architecture.md 5.4. Only the
 * stages required by M1 exist here; later stages are added in place so the
 * ordering never drifts.
 */
export function step(world: World, intents: ReadonlyMap<EntityId, Intent>): void {
  // 1-2. collect and apply intents
  for (const [id, intent] of intents) {
    const actor = world.actors.get(id)
    if (actor) actor.intent = intent
  }

  // 4. movement
  updateMovement(world, TICK_DT)

  world.tick += 1
}
