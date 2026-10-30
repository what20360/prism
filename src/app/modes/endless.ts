import { ENEMIES } from '../../content/enemies'
import { applyRoom, type RoomSpec } from '../../core/dungeon'
import { circleIntersectsRect, distance } from '../../core/collision'
import { createRoomPickups } from '../../core/roomResources'
import { createRng, nextFloat, type Rng } from '../../core/rng'
import { EXIT_RECT } from '../../core/systems/room'
import type { Vec2 } from '../../core/types'
import { getPlayer, spawnEnemy, type EnemySpawnSpec, type World } from '../../core/world'

export const ENDLESS_RULES = { tailAlpha: 2.5, finiteMin: 0.5, finiteMax: 2.5, respawnTicks: 60,
  growth: { maxHp: 1.18, damage: 1.13, armor: 1.09, speed: 1.012, bulletSpeed: 1.015, fireRate: 1.01, range: 1.008 } } as const
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
  const typeRoll = nextFloat(rng), type = typeRoll < 0.6 ? ENEMIES.drifter! : typeRoll < 0.9 ? ENEMIES.turret! : ENEMIES.warden!
  const factor = endlessFactor(rng, open), elite = type.hasCore
  const stat = (base: number, growth: number, exponent = 1, bias = 1): number => {
    const mean = finite(base * growth ** (floor - 1))
    const result = finite(mean * factor ** exponent * bias * (0.8 + 0.4 * nextFloat(rng)))
    return open ? result : Math.min(result, finite(mean * ENDLESS_RULES.finiteMax))
  }
  const g = ENDLESS_RULES.growth
  const attrs = { ...type.attrs,
    maxHp: stat(28, g.maxHp, 1, elite ? 1.4 : 1), damage: stat(6, g.damage, 0.7), armor: stat(12, g.armor, 0.5, elite ? 1.2 : 0.6),
    speed: type.behavior === 'chase' ? stat(150, g.speed, 0.2) : 0,
    bulletSpeed: stat(380, g.bulletSpeed, 0.2), fireRate: type.behavior === 'chase' ? 0 : stat(0.6, g.fireRate, 0.2),
    range: stat(750, g.range, 0.1), shield: 0,
  }
  return { pos: { x: 1600, y: 400 }, attrs, tier: elite ? 'elite' : 'normal', behavior: type.behavior,
    contactDamage: type.behavior === 'chase' ? attrs.damage : 0, hasCore: type.hasCore,
    name: `${open && factor > ENDLESS_RULES.finiteMax ? '异常·' : ''}${type.behavior === 'chase' ? '游荡者' : elite ? '核心守卫' : '炮台'}` }
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
}
export function createEndlessMode(): EndlessMode {
  let floor = 1, seed = 0, rng = createRng(0), population = 0, respawned = 0, queue: number[] = []
  const room = (): RoomSpec => ({ id: 'endless', kind: 'combat', bounds: ARENA, walls: [], entry: ENTRY, spawns: [], pickups: [] })
  const freePosition = (walls: RoomSpec['walls'], radius: number, avoid: Vec2): Vec2 => {
    for (let i = 0; i < 160; i++) {
      const pos = { x: 100 + nextFloat(rng) * 3000, y: 300 + nextFloat(rng) * 1100 }
      if (distance(pos, ENTRY) < 550 || distance(pos, avoid) < 650 || walls.some((wall) => circleIntersectsRect(pos.x, pos.y, radius + 8, wall))) continue
      return pos
    }
    for (const pos of [{ x: 1600, y: 400 }, { x: 1600, y: 1000 }, { x: 400, y: 400 }, { x: 2800, y: 400 }]) {
      if (distance(pos, avoid) >= 650 && !walls.some((wall) => circleIntersectsRect(pos.x, pos.y, radius + 8, wall))) return pos
    }
    return { x: 1600, y: 400 }
  }
  const enter = (world: World) => {
    rng = createRng((seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0)
    population = endlessCount(floor); respawned = 0; queue = []
    const walls: { x: number; y: number; width: number; height: number }[] = []
    const pairs = Math.floor(nextFloat(rng) * 3)
    for (let i = 0; i < pairs; i++) {
      const x = 420 + nextFloat(rng) * 600, y = 350 + i * 450 + nextFloat(rng) * 120
      const width = 120 + nextFloat(rng) * 160, height = 180 + nextFloat(rng) * 180
      walls.push({ x, y, width, height }, { x: 3200 - x - width, y, width, height })
    }
    const geometry = { ...room(), id: `endless-${floor}`, walls }
    const spawns = Array.from({ length: population }, () => {
      const spec = rollEndlessEnemy(floor, rng)
      return { ...spec, pos: freePosition(walls, spec.attrs.radius, ENTRY), rewardMultiplier: 1 }
    })
    const scale = finite(1.13 ** (floor - 1))
    const pickups = createRoomPickups(rng, geometry).map((pickup) => ({ ...pickup, value: pickup.kind === 'shard' ? finite(pickup.value * scale) : pickup.value }))
    applyRoom(world, { ...geometry, spawns, pickups })
    if (floor % 5 === 0) world.room.exit = EXIT_RECT
  }
  const advance = (world: World) => { floor += 1; enter(world) }
  return { room, initialize: (world) => { seed = world.seed; floor = 1; enter(world) }, advance,
    afterStep: (world) => {
      if (world.gameOver) return
      if (world.exitReached) { advance(world); return }
      const open = floor % 5 === 0
      for (const [id, actor] of world.actors) if (actor.team === 'enemy' && !actor.alive) {
        world.actors.delete(id)
        if (open) queue.push(world.tick + ENDLESS_RULES.respawnTicks)
      }
      if (!open) return
      const due = queue.filter((tick) => tick <= world.tick); queue = queue.filter((tick) => tick > world.tick)
      for (const _tick of due) {
        const spec = rollEndlessEnemy(floor, rng, true)
        respawned += 1
        spawnEnemy(world, { ...spec, pos: freePosition(world.room.walls, spec.attrs.radius, getPlayer(world).pos), rewardMultiplier: endlessReward(respawned, population) })
      }
      world.room.exit = EXIT_RECT; world.roomCleared = false
      if (world.room.phase !== 'entered') world.room.phase = 'combat'
    },
    state: (world) => ({ seed, floor, open: floor % 5 === 0, initialCount: population,
      alive: [...world.actors.values()].filter((actor) => actor.team === 'enemy' && actor.alive).length,
      pending: world.pendingSpawns.length + queue.length, respawned, nextReward: endlessReward(respawned + 1, population),
      rngState: rng.state, spawnQueue: [...queue] }),
  }
}
