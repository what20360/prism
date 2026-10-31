import type { RoomSpec } from '../core/dungeon'
import type { Rect } from '../core/types'
import type { EnemySpawnSpec } from '../core/world'
import type { Vec2 } from '../core/types'
import { createRng, nextFloat, nextInt, type Rng } from '../core/rng'
import { resolveSpawnPosition, circleIntersectsRect } from '../core/collision'
import { dungeonProfile, dungeonDifficulty, type DungeonDifficulty } from './difficulties'
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
function legacyDungeon(): RoomSpec[] {
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

export interface DungeonOptions { seed: number; difficulty: DungeonDifficulty }
function populateWave(original: readonly EnemySpawnSpec[], count: number, depth: number, difficulty: DungeonDifficulty, walls: readonly Rect[], rng: Rng, reserved: readonly EnemySpawnSpec[] = []): EnemySpawnSpec[] {
  const profile = dungeonProfile(difficulty, depth), placed: EnemySpawnSpec[] = []
  for (let i = 0; i < count; i++) {
    const source = original[i % original.length]!, factor = difficulty === 1 ? 1 : 0.88 + nextFloat(rng) * 0.24
    const attrs = { ...source.attrs, maxHp: source.attrs.maxHp * profile.hp * factor, damage: source.attrs.damage * profile.damage * factor,
      armor: source.attrs.armor + profile.armor, speed: source.attrs.speed * profile.speed, bulletSpeed: source.attrs.bulletSpeed * profile.bulletSpeed,
      fireRate: source.attrs.fireRate * profile.fireRate }
    let pos = source.pos
    for (let attempt = 0; attempt < 80; attempt++) {
      const candidate = resolveSpawnPosition({ x: nextInt(rng, 180, 3020), y: nextInt(rng, 180, 1340) }, attrs.radius + 4, walls, ARENA)
      if (!walls.some((w) => circleIntersectsRect(candidate.x, candidate.y, attrs.radius + 4, w)) && Math.hypot(candidate.x - ENTRY.x, candidate.y - ENTRY.y) > 360 && [...reserved, ...placed].every((s) => Math.hypot(candidate.x - s.pos.x, candidate.y - s.pos.y) > s.attrs.radius + attrs.radius + 35)) { pos = candidate; break }
    }
    pos = resolveSpawnPosition(pos, attrs.radius + 4, walls, ARENA)
    placed.push({ ...source, attrs, pos, contactDamage: source.contactDamage * profile.damage * factor })
  }
  return placed
}
/** Same seed and difficulty produce identical complete room/wave specifications. */
export function buildDungeon(options?: DungeonOptions): RoomSpec[] {
  if (!options) return legacyDungeon()
  const difficulty = dungeonDifficulty(options.difficulty), rng = createRng(options.seed)
  return legacyDungeon().map((room, index) => {
    if (room.kind === 'safe') return room
    const depth = index / ROOMS_PER_FLOOR, profile = dungeonProfile(difficulty, depth)
    const walls = room.kind === 'boss' ? [] : WALL_SETS[nextInt(rng, 0, WALL_SETS.length)]!
    const count = Math.ceil(room.spawns.length * profile.count), waves: EnemySpawnSpec[][] = []
    for (let wave = 0; wave < profile.waves; wave++) {
      if (room.kind === 'boss' && difficulty > 1) {
        const final = wave === profile.waves - 1
        if (final) {
          const boss = populateWave(room.spawns, 1, depth, difficulty, walls, rng)
          const adds = populateWave(combatSpawns(4, 3), Math.ceil((difficulty - 1) * 0.7), depth, difficulty, walls, rng, boss)
          waves.push([...boss, ...adds])
        } else waves.push(populateWave(guardSpawns(4), Math.ceil(3 * profile.count), depth, difficulty, walls, rng))
      } else waves.push(populateWave(room.spawns, count, depth, difficulty, walls, rng))
    }
    return { ...room, walls, spawns: waves[0]!, waves: waves.slice(1) }
  })
}
