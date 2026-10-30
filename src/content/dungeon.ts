import type { RoomSpec } from '../core/dungeon'
import type { Rect } from '../core/types'
import type { EnemySpawnSpec } from '../core/world'
import type { Vec2 } from '../core/types'
import { ENEMIES } from './enemies'

const ENTRY: Vec2 = { x: 1600, y: 1560 }

export const ARENA: Rect = { x: 0, y: 0, width: 3200, height: 1800 }

/** Wall layouts keep the centre corridor (x 1400-1800) clear for entry and exit. */
const WALL_SETS: readonly (readonly { x: number; y: number; width: number; height: number }[])[] = [
  [
    { x: 600, y: 420, width: 180, height: 960 },
    { x: 2420, y: 420, width: 180, height: 960 },
    { x: 1000, y: 760, width: 180, height: 180 },
    { x: 2020, y: 760, width: 180, height: 180 },
  ],
  [
    { x: 1200, y: 300, width: 160, height: 440 },
    { x: 1840, y: 300, width: 160, height: 440 },
    { x: 1200, y: 1060, width: 160, height: 440 },
    { x: 1840, y: 1060, width: 160, height: 440 },
    { x: 880, y: 700, width: 260, height: 140 },
    { x: 2060, y: 700, width: 260, height: 140 },
  ],
  [
    { x: 700, y: 300, width: 300, height: 300 },
    { x: 2200, y: 300, width: 300, height: 300 },
    { x: 700, y: 1200, width: 300, height: 300 },
    { x: 2200, y: 1200, width: 300, height: 300 },
    { x: 1450, y: 820, width: 300, height: 160 },
  ],
]

/**
 * Free-standing spawn points: each one keeps clearance from the player entry
 * (>= 180 units) and from every wall in all three layouts, so the safety net in
 * `resolveSpawnPosition` never has to move them.
 */
const ANCHORS: readonly Vec2[] = [
  { x: 400, y: 380 },
  { x: 2800, y: 380 },
  { x: 400, y: 1250 },
  { x: 2800, y: 1250 },
  { x: 1000, y: 1000 },
  { x: 2200, y: 1000 },
  { x: 1600, y: 380 },
  { x: 1600, y: 1250 },
]

function spawn(type: string, pos: Vec2): EnemySpawnSpec {
  const definition = ENEMIES[type]
  if (!definition) throw new Error(`unknown enemy type: ${type}`)
  return {
    pos,
    attrs: definition.attrs,
    tier: definition.tier,
    behavior: definition.behavior,
    contactDamage: definition.contactDamage,
    hasCore: definition.hasCore,
    name: definition.name,
  }
}

function combatSpawns(floor: number, room: number): EnemySpawnSpec[] {
  const count = Math.min(6, 2 + floor + 1)
  const spawns: EnemySpawnSpec[] = []

  for (let i = 0; i < count; i += 1) {
    const anchor = ANCHORS[(i + floor * 3 + room * 2) % ANCHORS.length]
    if (!anchor) continue
    const type = (i + floor) % 3 === 0 ? 'turret' : 'drifter'
    spawns.push(spawn(type, anchor))
  }

  return spawns
}

function guardSpawns(floor: number): EnemySpawnSpec[] {
  return [
    spawn('warden', { x: 1600, y: 520 + floor * 20 }),
    spawn('drifter', { x: 900, y: 900 }),
    spawn('drifter', { x: 2300, y: 900 }),
  ]
}

/**
 * Linear dungeon: 5 floors x 5 rooms (safe, 3 combat, guard) + one boss room.
 * Pure function of constants, so the layout is identical across runs.
 */
export function buildDungeon(): RoomSpec[] {
  const rooms: RoomSpec[] = []

  for (let floor = 0; floor < 5; floor += 1) {
    for (let room = 0; room < 5; room += 1) {
      const id = `f${floor + 1}r${room + 1}`
      const walls = WALL_SETS[(floor * 5 + room) % WALL_SETS.length] ?? []

      if (room === 0) {
        rooms.push({ id, kind: 'safe', bounds: ARENA, walls: [], spawns: [], entry: ENTRY })
      } else if (room === 4) {
        rooms.push({ id, kind: 'guard', bounds: ARENA, walls, spawns: guardSpawns(floor), entry: ENTRY })
      } else {
        rooms.push({ id, kind: 'combat', bounds: ARENA, walls, spawns: combatSpawns(floor, room), entry: ENTRY })
      }
    }
  }

  rooms.push({
    id: 'boss',
    kind: 'boss',
    bounds: ARENA,
    walls: [],
    spawns: [spawn('boss', { x: 1600, y: 520 })],
    entry: ENTRY,
  })

  return rooms
}

export const ROOMS_PER_FLOOR = 5
