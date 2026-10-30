import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import type { AttrSet } from '../../src/core/attrs'
import { step } from '../../src/core/simulation'
import { applyDamage } from '../../src/core/systems/damage'
import {
  MAX_MINES_PER_TEAM,
  MINE_BLAST_RADIUS,
  MINE_SLOW_RADIUS,
  MINE_TRIGGER_RADIUS,
  tryPlaceMine,
} from '../../src/core/systems/mines'
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
  kind: 'combat',
  entry: { x: 300, y: 540 },
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
    triggerRadius: MINE_TRIGGER_RADIUS,
    blastRadius: MINE_BLAST_RADIUS,
    slowRadius: MINE_SLOW_RADIUS,
    slowMultiplier: 2,
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

  it('a mine arms for an enemy standing well outside the old trigger radius', () => {
    const standoff = MINE_TRIGGER_RADIUS - 10
    const world = makeWorld({
      enemies: [enemy({ maxHp: 200 }, { pos: { x: 500 + standoff, y: 540 } })],
    })
    world.mines.push(mineAt(500, 540))

    step(world, new Map())

    expect(world.mines[0]?.fuseTicks).not.toBeNull()
  })

  it('placing at the mine cap replaces the oldest mine instead of failing', () => {
    const world = makeWorld()
    const player = getPlayer(world)

    for (let i = 0; i < MAX_MINES_PER_TEAM; i += 1) {
      player.pos = { x: 400 + i * 40, y: 540 }
      player.mineCooldownTicks = 0
      tryPlaceMine(world, player)
    }

    expect(world.mines).toHaveLength(MAX_MINES_PER_TEAM)
    const oldestId = world.mines[0]?.id

    player.pos = { x: 900, y: 540 }
    player.mineCooldownTicks = 0
    tryPlaceMine(world, player)

    expect(world.mines).toHaveLength(MAX_MINES_PER_TEAM)
    expect(world.mines.some((mine) => mine.id === oldestId)).toBe(false)
    expect(world.mines[world.mines.length - 1]?.pos).toEqual({ x: 900, y: 540 })
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

    expect(player.hp).toBeCloseTo(player.attrs.maxHp - 10, 6)
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

    expect(player.hp).toBeCloseTo(player.attrs.maxHp - 10, 6)
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

  it('opens a cleared room without granting a clear bonus', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1 })] })

    tick(world, 300)

    expect(world.roomCleared).toBe(true)
    const shards = world.shards
    step(world, new Map())
    expect(world.shards).toBe(shards)
  })
})

describe('fire control', () => {
  it('manual aim overrides auto targeting', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1000 }, { pos: { x: 300, y: 100 } })] })
    const player = getPlayer(world)
    player.intent = { move: { x: 0, y: 0 }, aim: { x: -1, y: 0 } }

    step(world, new Map())

    const shot = world.projectiles.find((projectile) => projectile.team === 'player')
    expect(shot).toBeDefined()
    expect(shot?.vel.x).toBeLessThan(0)
    expect(Math.abs(shot?.vel.y ?? 1)).toBeLessThan(1)
  })

  it('intent.fire = false suppresses the shot without touching the cooldown', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1000 })] })
    const player = getPlayer(world)
    player.intent = { move: { x: 0, y: 0 }, fire: false }

    step(world, new Map())

    expect(world.projectiles.filter((projectile) => projectile.team === 'player')).toHaveLength(0)
    expect(player.fireCooldownTicks).toBe(0)
  })
})

describe('combat text', () => {
  it('emits damage and shard floaters when the player deals damage', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 1000 })] })
    const target = firstEnemy(world)
    world.floaters = []

    applyDamage(world, {
      targetId: target.id,
      sourceId: getPlayer(world).id,
      sourceTeam: 'player',
      raw: 40,
      penetration: 0,
      isCore: false,
    })

    const kinds = world.floaters.map((floater) => floater.kind)
    expect(kinds).toContain('damage')
    expect(kinds).toContain('shard')
    expect(target.damageFlashTicks).toBeGreaterThan(0)
  })

  it('separates overflow damage into its own floater', () => {
    const world = makeWorld({ enemies: [enemy({ maxHp: 10 })] })
    const target = firstEnemy(world)
    world.floaters = []

    applyDamage(world, {
      targetId: target.id,
      sourceId: getPlayer(world).id,
      sourceTeam: 'player',
      raw: 50,
      penetration: 0,
      isCore: false,
    })

    expect(world.floaters.some((floater) => floater.kind === 'overflow')).toBe(true)
  })
})
