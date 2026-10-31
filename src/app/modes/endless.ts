import { ENEMIES } from '../../content/enemies'
import { withMonsterTraits, clampMonsterStats } from '../../content/monsterTraits'
import { applyRoom, type RoomSpec } from '../../core/dungeon'
import { circleIntersectsRect, distance } from '../../core/collision'
import { createRoomPickups } from '../../core/roomResources'
import { createRng, nextFloat, type Rng } from '../../core/rng'
import { exitForRoom } from '../../core/systems/room'
import { pickLevelSet } from '../../content/levelSets'
import type { Vec2 } from '../../core/types'
import { getPlayer, spawnEnemy, type EnemySpawnSpec, type World } from '../../core/world'

export const ENDLESS_RULES = { tailAlpha: 2.5, finiteMin: 0.5, finiteMax: 2.5, respawnTicks: 60,
  growth: { maxHp: 1.18, damage: 1.13, armor: 1.09, speed: 1.012, bulletSpeed: 1.015, fireRate: 1.01, range: 1.008, block: 1.08 } } as const
const ARENA = { x: 0, y: 0, width: 3200, height: 1800 }, ENTRY = { x: 1600, y: 1560 }
const finite = (value: number) => Math.min(Number.MAX_VALUE / 1e6, value)
export function endlessCount(floor: number): number { return 4 + Math.ceil(2 * Math.sqrt(floor)) }
export function endlessReward(replacements: number, population: number): number { return (1 + replacements / population) ** -2 }
export function worldSeed(text: string): number {
  if (!text.trim()) return 20261030
  if (/^\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text))) return Number(text) >>> 0
  let value = 2166136261
  for (const character of text.trim() || '20261030') value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return value >>> 0
}
/** A finite-mean Pareto tail; open floors perform no floor-strength truncation. */
export function endlessFactor(rng: Rng, open: boolean): number {
  const value = (1 - 1 / ENDLESS_RULES.tailAlpha) / (1 - nextFloat(rng)) ** (1 / ENDLESS_RULES.tailAlpha)
  return open ? value : Math.max(ENDLESS_RULES.finiteMin, Math.min(ENDLESS_RULES.finiteMax, value))
}
export function rollEndlessEnemy(floor: number, rng: Rng, open = floor % 5 === 0): EnemySpawnSpec {
  const typeRoll = nextFloat(rng), type = ENEMIES[typeRoll < 0.3 ? 'drifter' : typeRoll < 0.46 ? 'turret' : typeRoll < 0.64 ? 'stalker' : typeRoll < 0.8 ? 'bomber' : typeRoll < 0.93 ? 'warden' : 'lancer']!
  const factor = endlessFactor(rng, open), elite = type.hasCore
  const stat = (base: number, growth: number, exponent = 1, bias = 1): number => {
    const mean = finite(base * growth ** (floor - 1))
    const result = finite(mean * factor ** exponent * bias * (0.8 + 0.4 * nextFloat(rng)))
    return open ? result : Math.min(result, finite(mean * ENDLESS_RULES.finiteMax))
  }
  const g = ENDLESS_RULES.growth
  const attrs = { ...type.attrs,
    maxHp: stat(50, g.maxHp, 1, elite ? 1.6 : type.attrs.maxHp / 50), damage: stat(9, g.damage, 0.7, Math.max(0.7, type.attrs.damage / 13)), armor: stat(15, g.armor, 0.5, elite ? 1.2 : 0.6), block: stat(3, g.block, 0.5, elite ? 1 : 0.25),
    speed: type.attrs.speed > 0 ? stat(185, g.speed, 0.2, type.attrs.speed / 185) : 0,
    bulletSpeed: stat(430, g.bulletSpeed, 0.2), fireRate: type.attrs.fireRate > 0 ? stat(0.8, g.fireRate, 0.2, type.attrs.fireRate / 0.8) : 0,
    range: stat(900, g.range, 0.1), shield: 0,
  }
  let result = withMonsterTraits({ pos: { x: 1600, y: 400 }, attrs, tier: elite ? 'elite' : 'normal', behavior: type.behavior,
    contactDamage: type.contactDamage > 0 ? attrs.damage : 0, hasCore: type.hasCore, attackType: type.attackType, traits: type.traits,
    name: `${open && factor > ENDLESS_RULES.finiteMax ? '异常·' : ''}${type.name}` }, rng, Math.sqrt(floor))
  if (!open) {
    const upper = ENDLESS_RULES.finiteMax
    result = { ...result, attrs: clampMonsterStats(result.attrs, { maxHp: finite(50 * g.maxHp ** (floor - 1) * upper), damage: finite(9 * g.damage ** (floor - 1) * upper),
      armor: finite(15 * g.armor ** (floor - 1) * upper), block: finite(3 * g.block ** (floor - 1) * upper), speed: finite(185 * g.speed ** (floor - 1) * upper),
      bulletSpeed: finite(430 * g.bulletSpeed ** (floor - 1) * upper), fireRate: finite(0.8 * g.fireRate ** (floor - 1) * upper), range: finite(900 * g.range ** (floor - 1) * upper),
      physicalResist: 60, electricResist: 60, heatResist: 60 }) }
  }
  return { ...result, contactDamage: type.contactDamage > 0 ? result.attrs.damage : 0 }

}
export interface EndlessState {
  readonly seed: number; readonly floor: number; readonly open: boolean; readonly initialCount: number
  readonly alive: number; readonly pending: number; readonly respawned: number; readonly nextReward: number
  readonly rngState: number; readonly spawnQueue: readonly number[]
}
export interface EndlessMode {
  room(): RoomSpec
  initialize(world: World): void
  afterStep(world: World): void
  advance(world: World): void
  state(world: World): EndlessState
  checkpoint(): EndlessCheckpoint
  restore(world: World, saved: EndlessCheckpoint): void
}
export interface EndlessCheckpoint { readonly floor: number; readonly rngState: number; readonly respawned: number; readonly spawnQueue: readonly number[] }
export function createEndlessMode(): EndlessMode {
  let floor = 1, seed = 0, rng = createRng(0), population = 0, respawned = 0, queue: number[] = []
  const room = (): RoomSpec => ({ id: 'endless', kind: 'combat', bounds: ARENA, walls: [], entry: ENTRY, spawns: [], pickups: [] })
  let currentEntry: Vec2 = ENTRY, currentPatrol: readonly Vec2[] = []
  const getEntry = () => currentEntry
  const freePosition = (walls: RoomSpec['walls'], radius: number, avoid: Vec2): Vec2 => {
    for (let i = 0; i < 160; i++) {
      const pos = { x: 100 + nextFloat(rng) * 3000, y: 300 + nextFloat(rng) * 1100 }
      if (distance(pos, getEntry()) < 550 || distance(pos, avoid) < 650 || walls.some((wall) => circleIntersectsRect(pos.x, pos.y, radius + 8, wall))) continue
      return pos
    }
    for (const pos of [...currentPatrol, { x: 1600, y: 400 }, { x: 1600, y: 1000 }, { x: 400, y: 400 }, { x: 2800, y: 400 }]) {
      if (distance(pos, avoid) >= 650 && !walls.some((wall) => circleIntersectsRect(pos.x, pos.y, radius + 8, wall))) return pos
    }
    return { x: 1600, y: 400 }
  }
  const enter = (world: World) => {
    rng = createRng((seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0)
    population = endlessCount(floor); respawned = 0; queue = []
    const selected = pickLevelSet(rng, 'endless', floor < 5 ? 'combat' : undefined)
    currentEntry = selected.entry; currentPatrol = selected.design?.patrol ?? []
    const geometry = { ...selected, kind: 'combat' as const, id: `endless-${floor}` }, walls = geometry.walls
    const spawns = Array.from({ length: population }, (_, index) => {
      const spec = rollEndlessEnemy(floor, rng)
      if (index === 0 && selected.design?.id === 'silk-den') {
        const q = selected.spawns[0]!, g = ENDLESS_RULES.growth, open = floor % 5 === 0
        const attrs = { ...q.attrs, maxHp: Math.min(finite(spec.attrs.maxHp * (open ? 8 : 2)), open ? Number.MAX_VALUE : finite(50 * g.maxHp ** (floor - 1) * ENDLESS_RULES.finiteMax)),
          damage: spec.attrs.damage, armor: spec.attrs.armor, block: spec.attrs.block, speed: Math.min(spec.attrs.speed || 150, floor % 5 === 0 ? Number.MAX_VALUE : finite(185 * g.speed ** (floor - 1) * ENDLESS_RULES.finiteMax) / 1.3), bulletSpeed: spec.attrs.bulletSpeed,
          range: spec.attrs.range, mineDamage: finite(spec.attrs.damage * 1.8), mineHp: Math.max(10, spec.attrs.maxHp * 0.2) }
        return { ...q, attrs, rewardMultiplier: 1 }
      }
      return { ...spec, pos: freePosition(walls, spec.attrs.radius, geometry.entry), rewardMultiplier: 1 }
    })
    const scale = finite(1.13 ** (floor - 1))
    const pickups = createRoomPickups(rng, geometry).map((pickup) => ({ ...pickup, value: pickup.kind === 'shard' ? finite(pickup.value * scale) : pickup.value }))
    applyRoom(world, { ...geometry, spawns, pickups })
    if (floor % 5 === 0) world.room.exit = exitForRoom(world, true)
  }
  const advance = (world: World) => { floor += 1; enter(world) }
  return { room, initialize: (world) => { seed = world.seed; floor = 1; enter(world) }, advance,
    checkpoint: () => ({ floor, rngState: rng.state, respawned, spawnQueue: [...queue] }),
    restore: (world, saved) => { seed = world.seed; currentEntry = world.room.entry; currentPatrol = world.room.design?.patrol ?? []; floor = saved.floor; rng = createRng(saved.rngState); respawned = saved.respawned; queue = [...saved.spawnQueue]; population = endlessCount(floor) },
    afterStep: (world) => {
      if (world.gameOver) return
      if (world.exitReached) { advance(world); return }
      const open = floor % 5 === 0
      for (const [id, actor] of world.actors) if (actor.team === 'enemy' && !actor.alive) {
        world.actors.delete(id)
        if (open && !actor.spider) queue.push(world.tick + ENDLESS_RULES.respawnTicks)
      }
      if (!open) return
      const due = queue.filter((tick) => tick <= world.tick); queue = queue.filter((tick) => tick > world.tick)
      for (let i = 0; i < due.length; i++) {
        const spec = rollEndlessEnemy(floor, rng, true)
        respawned += 1
        spawnEnemy(world, { ...spec, pos: freePosition(world.room.walls, spec.attrs.radius, getPlayer(world).pos), rewardMultiplier: endlessReward(respawned, population) })
      }
      world.room.exit = exitForRoom(world, true); world.roomCleared = false
      if (world.room.phase !== 'entered') world.room.phase = 'combat'
    },
    state: (world) => ({ seed, floor, open: floor % 5 === 0, initialCount: population,
      alive: [...world.actors.values()].filter((actor) => actor.team === 'enemy' && actor.alive).length,
      pending: world.pendingSpawns.length + queue.length, respawned, nextReward: endlessReward(respawned + 1, population),
      rngState: rng.state, spawnQueue: [...queue] }),
  }
}
