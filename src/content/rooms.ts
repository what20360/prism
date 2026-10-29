import type { EnemySpawnSpec, RoomTemplate } from '../core/world'
import { ENEMIES } from './enemies'

function spawn(enemy: string, x: number, y: number): EnemySpawnSpec {
  const type = ENEMIES[enemy]
  if (!type) throw new Error(`unknown enemy type: ${enemy}`)
  return {
    pos: { x, y },
    attrs: type.attrs,
    tier: type.tier,
    behavior: type.behavior,
    contactDamage: type.contactDamage,
    hasCore: type.hasCore,
  }
}

/**
 * M4 sandbox: the arena is larger than the 1920x1080 viewport, so the camera
 * follows the player (docs/requirements.md 4.2).
 */
export const TRAINING_ROOM: RoomTemplate = {
  id: 'training',
  bounds: { x: 0, y: 0, width: 3200, height: 1800 },
  walls: [
    { x: 600, y: 480, width: 200, height: 840 },
    { x: 2400, y: 480, width: 200, height: 840 },
    { x: 1400, y: 220, width: 400, height: 150 },
    { x: 1400, y: 1430, width: 400, height: 150 },
    { x: 1200, y: 820, width: 160, height: 160 },
    { x: 1840, y: 820, width: 160, height: 160 },
  ],
  spawns: [
    spawn('drifter', 1000, 500),
    spawn('drifter', 2200, 1300),
    spawn('turret', 1000, 1300),
    spawn('turret', 2200, 500),
    spawn('drifter', 1600, 400),
  ],
}