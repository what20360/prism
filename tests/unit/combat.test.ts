import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import type { AttrSet } from '../../src/core/attrs'
import { step } from '../../src/core/simulation'
import { applyDamage } from '../../src/core/systems/damage'
import type { Mine, Projectile } from '../../src/core/world'
import {
  createWorld,
  getPlayer,
  type EnemySpawnSpec,
  type RoomTemplate,
  type World,
} from '../../src/core/world'

const EMPTY_ROOM: RoomTemplate = {
  id: 'test',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  walls: [],
  spawns: [],
}

const tick = (world: World, times: number): void => {
  for (let i = 0; i < times; i += 1) step(world, new Map())
}

function makeWorld(options: { enemies?: EnemySpawnSpec[]; playerAttrs?: Partial<AttrSet> } = {}): World {
  return createWorld({
    seed: 1,
    room: { ...EMPTY_ROOM, spawns: options.enemies ?? [] },
    economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY,
    playerAttrs: { ...PLAYER_BASE_ATTRS, ...options.playerAttrs },
    playerSpawn: { x: 300, y: 540 },
  })
}

/** Stationary shooting dummy by default; attribute overrides come from the test. */
function enemy(attrs: Partial<AttrSet>, extra: Partial<EnemySpawnSpec> = {}): EnemySpawnSpec {
  return {
    pos: { x: 600, y: 540 },
    attrs: { ...PLAYER_BASE_ATTRS, fireRate: 0, speed: 0, ...attrs },
    tier: 'normal',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: false,
    ...extra,
  }
}

function firstEnemy(world: World) {
  for (const actor of world.actors.values()) {
    if (actor.team === 'enemy') return actor
  }
  throw new Error('no enemy')
}

function mineAt(x: number, y: number, overrides: Partial<Mine> = {}): Mine {
  return {
    id: 900,
    ownerId: 1,
    team: 'player',
    pos: { x, y },
    bodyRadius: 30,
    triggerRadius: 80,
    blastRadius: 200,
    slowRadius: 80,
    slowFactor: 0.6,
    damage: 30,
    hp: 1,
    fuseTicks: null,
    ...overrides,
  }
}

function bulletAt(x: number, y: number, team: Projectile['team'] = 'enemy'): Projectile {
  return {
    id: 901,
    ownerId: 0,
    team,
    pos: { x, y },
    prevPos: { x, y },
    vel: { x: 0, y: 0 },
    radius: 6,
    damage: 10,
    penetration: 0,
    pierceLeft: 1,
    innerMult: 1.5,
    travelLeft: 100,
    hitIds: [],
  }
}

describe('combat', () => {
  it('auto-fires, damages enemies and pays shards', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1000 })] })
    const target = firstEnemy(world)

    tick(world, 120)

    expect(target.hp).toBeLessThan(1000)
    expect(world.shards).toBeGreaterThan(0)
    expect(world.stats.damageDealt).toBeGreaterThan(0)
  })

  it('armor reduces incoming damage', () => {
    const soft = makeWorld({ enemies: [enemy({ maxHp: 1000, armor: 0 })] })
    const hard = makeWorld({ enemies: [enemy({ maxHp: 1000, armor: 100 })] })

    tick(soft, 120)
    tick(hard, 120)

    expect(1000 - firstEnemy(hard).hp).toBeLessThan(1000 - firstEnemy(soft).hp)
  })

  it('counts core hits and multiplies their damage', () => {
    const plain = makeWorld({
      playerAttrs: { pierce: 2 },
      enemies: [enemy({ maxHp: 1000 })],
    })
    const core = makeWorld({
      playerAttrs: { pierce: 2 },
      enemies: [enemy({ maxHp: 1000, coreRadiusMult: 1 }, { hasCore: true })],
    })

    tick(plain, 120)
    tick(core, 120)

    expect(core.stats.coreHits).toBeGreaterThan(0)
    expect(1000 - firstEnemy(core).hp).toBeGreaterThan(1000 - firstEnemy(plain).hp)
  })

  it('cannot reach the inner core with a single pierce layer', () => {
    const world = makeWorld({
      playerAttrs: { pierce: 1 },
      enemies: [enemy({ maxHp: 1000, coreRadiusMult: 1 }, { hasCore: true })],
    })

    tick(world, 120)

    expect(world.stats.coreHits).toBe(0)
    expect(firstEnemy(world).hp).toBeLessThan(1000)
  })

  it('mine detonation clears opposing bullets in range', () => {
    const world = makeWorld()
    world.mines.push(mineAt(500, 540, { fuseTicks: 1 }))
    world.projectiles.push(bulletAt(560, 540))

    step(world, new Map())

    expect(world.projectiles).toHaveLength(0)
    expect(world.mines).toHaveLength(0)
  })

  it('a bullet destroys a mine body before it explodes', () => {
    const world = makeWorld()
    world.mines.push(mineAt(500, 540))
    world.projectiles.push(bulletAt(500, 540))

    step(world, new Map())

    expect(world.mines).toHaveLength(0)
  })

  it('mine explosion damages opposing actors', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 200 }, { pos: { x: 520, y: 540 } })] })
    world.mines.push(mineAt(500, 540, { fuseTicks: 1 }))

    step(world, new Map())

    expect(firstEnemy(world).hp).toBeLessThan(200)
  })

  it('shard income from taking a hit uses pre-mitigation damage', () => {
    const world = makeWorld({ playerAttrs: { armor: 300 } })
    const player = getPlayer(world)

    applyDamage(world, {
      targetId: player.id,
      sourceId: 0,
      sourceTeam: 'enemy',
      raw: 40,
      penetration: 0,
      isCore: false,
    })

    expect(player.hp).toBeCloseTo(90, 6)
    expect(world.shards).toBeCloseTo(40 * DEFAULT_ECONOMY.takenRate, 10)
    expect(world.stats.damageTaken).toBeCloseTo(40, 10)
  })

  it('invulnerability frames nullify damage and rewards', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    const hit = {
      targetId: player.id,
      sourceId: 0,
      sourceTeam: 'enemy' as const,
      raw: 10,
      penetration: 0,
      isCore: false,
    }

    applyDamage(world, hit)
    const shardsAfterFirst = world.shards
    applyDamage(world, hit)

    expect(player.hp).toBeCloseTo(90, 6)
    expect(world.shards).toBeCloseTo(shardsAfterFirst, 10)
  })

  it('player death ends the run', () => {
    const world = makeWorld()
    const player = getPlayer(world)

    applyDamage(world, {
      targetId: player.id,
      sourceId: 0,
      sourceTeam: 'enemy',
      raw: 1000,
      penetration: 0,
      isCore: false,
    })

    expect(player.alive).toBe(false)
    expect(world.gameOver).toBe(true)

    const tickBefore = world.tick
    step(world, new Map())
    expect(world.tick).toBe(tickBefore)
  })

  it('grants the room clear bonus once all enemies are gone', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1 })] })

    tick(world, 300)

    expect(world.roomCleared).toBe(true)
    expect(world.shards).toBeGreaterThanOrEqual(DEFAULT_ECONOMY.roomClear)
  })
})
