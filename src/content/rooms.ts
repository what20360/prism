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

/** M2 combat sandbox: one room, mixed melee and ranged enemies. */
export const TRAINING_ROOM: RoomTemplate = {
  id: 'training',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  walls: [
    { x: 360, y: 300, width: 120, height: 480 },
    { x: 1440, y: 300, width: 120, height: 480 },
    { x: 820, y: 140, width: 280, height: 90 },
    { x: 820, y: 850, width: 280, height: 90 },
  ],
  spawns: [
    spawn('drifter', 620, 300),
    spawn('drifter', 1300, 780),
    spawn('drifter', 960, 700),
    spawn('turret', 600, 780),
    spawn('turret', 1320, 300),
  ],
}