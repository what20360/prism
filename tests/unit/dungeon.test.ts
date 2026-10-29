import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { buildDungeon, ROOMS_PER_FLOOR } from '../../src/content/dungeon'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { ENEMIES } from '../../src/content/enemies'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { applyRoom } from '../../src/core/dungeon'
import { step } from '../../src/core/simulation'
import { applyDamage } from '../../src/core/systems/damage'
import { EXIT_RECT } from '../../src/core/systems/room'
import type { EnemySpawnSpec, RoomKind, RoomTemplate } from '../../src/core/world'
import { createWorld, getPlayer, type World } from '../../src/core/world'

const BOUNDS = { x: 0, y: 0, width: 3200, height: 1800 }

function spawnOf(type: 'drifter' | 'boss', x: number, y: number, maxHp?: number): EnemySpawnSpec {
  const definition = ENEMIES[type]
  if (!definition) throw new Error(`unknown enemy: ${type}`)
  return {
    pos: { x, y },
    attrs: maxHp === undefined ? definition.attrs : { ...definition.attrs, maxHp },
    tier: definition.tier,
    behavior: definition.behavior,
    contactDamage: definition.contactDamage,
    hasCore: definition.hasCore,
  }
}

function roomWith(kind: RoomKind, spawns: EnemySpawnSpec[]): RoomTemplate {
  return {
    id: `test-${kind}`,
    kind,
    bounds: BOUNDS,
    walls: [],
    spawns,
    entry: { x: 1600, y: 1560 },
  }
}

function makeWorld(room: RoomTemplate): World {
  return createWorld({
    seed: 1,
    room,
    economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY,
    playerAttrs: PLAYER_BASE_ATTRS,
  })
}

function killEnemies(world: World): void {
  for (const actor of world.actors.values()) {
    if (actor.team !== 'enemy') continue
    actor.hp = 0
    actor.alive = false
  }
}

describe('dungeon layout', () => {
  it('builds 5 floors of 5 rooms plus a boss room', () => {
    const rooms = buildDungeon()

    expect(rooms).toHaveLength(5 * ROOMS_PER_FLOOR + 1)
    expect(rooms[0]?.kind).toBe('safe')
    expect(rooms[4]?.kind).toBe('guard')
    expect(rooms[rooms.length - 1]?.kind).toBe('boss')
    expect(rooms.filter((room) => room.kind === 'combat')).toHaveLength(15)
  })

  it('keeps the entry corridor clear of walls in every room', () => {
    for (const room of buildDungeon()) {
      for (const wall of room.walls) {
        const overlapsCorridor = wall.x < 1800 && wall.x + wall.width > 1400
        const overlapsEntry = wall.y + wall.height > 1400
        expect(overlapsCorridor && overlapsEntry).toBe(false)
      }
    }
  })
})

describe('room transitions', () => {
  it('opening a room replaces enemies and resets the exit', () => {
    const world = makeWorld(roomWith('combat', [spawnOf('drifter', 1200, 900)]))
    world.room.exit = EXIT_RECT

    applyRoom(world, roomWith('guard', [spawnOf('drifter', 800, 800)]))

    expect(world.room.kind).toBe('guard')
    expect(world.room.exit).toBeNull()
    expect(world.roomCleared).toBe(false)

    let enemies = 0
    for (const actor of world.actors.values()) {
      if (actor.team === 'enemy') enemies += 1
    }
    expect(enemies).toBe(1)
  })

  it('clearing a combat room opens the exit, and entering it flags the transition', () => {
    const world = makeWorld(roomWith('combat', [spawnOf('drifter', 1200, 900)]))
    killEnemies(world)

    step(world, new Map())
    expect(world.roomCleared).toBe(true)
    expect(world.room.exit).toEqual(EXIT_RECT)

    const player = getPlayer(world)
    player.pos = { x: EXIT_RECT.x + EXIT_RECT.width / 2, y: EXIT_RECT.y + EXIT_RECT.height / 2 }
    step(world, new Map())

    expect(world.exitReached).toBe(true)
  })

  it('a boss room ends the run instead of opening a door', () => {
    const world = makeWorld(roomWith('boss', [spawnOf('boss', 1600, 520, 1)]))
    killEnemies(world)

    step(world, new Map())

    expect(world.roomCleared).toBe(true)
    expect(world.room.exit).toBeNull()
    expect(world.victory).toBe(true)
  })
})

describe('boss', () => {
  it('switches to phase 2 below half health', () => {
    const world = makeWorld(roomWith('boss', [spawnOf('boss', 1600, 520)]))
    const boss = [...world.actors.values()].find((actor) => actor.behavior === 'boss')
    expect(boss).toBeDefined()
    if (!boss) return

    const fireRateBefore = boss.attrs.fireRate

    applyDamage(world, {
      targetId: boss.id,
      sourceId: getPlayer(world).id,
      sourceTeam: 'player',
      raw: boss.attrs.maxHp * 0.6,
      penetration: 1000,
      isCore: false,
    })
    step(world, new Map())

    expect(boss.phase).toBe(2)
    expect(boss.attrs.fireRate).toBeGreaterThan(fireRateBefore)
  })

  it('clears player bullets around itself periodically', () => {
    const world = makeWorld(roomWith('boss', [spawnOf('boss', 1600, 520)]))
    const boss = [...world.actors.values()].find((actor) => actor.behavior === 'boss')
    const player = getPlayer(world)
    if (!boss) return

    world.projectiles.push({
      id: 900,
      ownerId: player.id,
      team: 'player',
      pos: { x: boss.pos.x + 100, y: boss.pos.y },
      prevPos: { x: boss.pos.x + 100, y: boss.pos.y },
      vel: { x: 0, y: 0 },
      radius: 10,
      damage: 10,
      penetration: 0,
      pierceLeft: 1,
      innerMult: 1.5,
      travelLeft: 5000,
      hitIds: [],
    })

    step(world, new Map())

    const playerBullets = world.projectiles.filter((projectile) => projectile.team === 'player')
    expect(playerBullets).toHaveLength(0)
  })
})
