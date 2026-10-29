import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import type { Intent } from '../../src/core/controller'
import { step } from '../../src/core/simulation'
import type { EntityId } from '../../src/core/types'
import { createWorld, getPlayer, type RoomTemplate } from '../../src/core/world'

const EMPTY_ROOM: RoomTemplate = {
  id: 'empty',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  walls: [],
  spawns: [],
}

function makeWorld(spawnX: number, spawnY: number, room: RoomTemplate = EMPTY_ROOM) {
  return createWorld({
    seed: 1,
    room,
    economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY,
    playerAttrs: PLAYER_BASE_ATTRS,
    playerSpawn: { x: spawnX, y: spawnY },
  })
}

function run(world: ReturnType<typeof makeWorld>, intent: Intent, ticks: number): void {
  const player = getPlayer(world)
  const intents = new Map<EntityId, Intent>([[player.id, intent]])
  for (let i = 0; i < ticks; i += 1) step(world, intents)
}

describe('movement', () => {
  it('moves exactly speed * elapsed in one second', () => {
    const world = makeWorld(300, 540)
    run(world, { move: { x: 1, y: 0 } }, 60)

    expect(getPlayer(world).pos.x).toBeCloseTo(300 + PLAYER_BASE_ATTRS.speed, 6)
    expect(getPlayer(world).pos.y).toBeCloseTo(540, 6)
    expect(world.tick).toBe(60)
  })

  it('normalizes diagonal input so speed is unchanged', () => {
    const world = makeWorld(300, 540)
    run(world, { move: { x: 1, y: 1 } }, 60)

    const player = getPlayer(world)
    const distance = Math.hypot(player.pos.x - 300, player.pos.y - 540)
    expect(distance).toBeCloseTo(PLAYER_BASE_ATTRS.speed, 4)
  })

  it('clamps to room bounds instead of leaving the room', () => {
    const world = makeWorld(20, 540)
    run(world, { move: { x: -1, y: 0 } }, 60)

    expect(getPlayer(world).pos.x).toBeCloseTo(PLAYER_BASE_ATTRS.radius, 6)
  })

  it('stops at a wall and slides along it', () => {
    const room: RoomTemplate = {
      ...EMPTY_ROOM,
      walls: [{ x: 400, y: 400, width: 200, height: 280 }],
    }
    const world = makeWorld(300, 540, room)
    run(world, { move: { x: 1, y: 0 } }, 120)

    const blocked = getPlayer(world)
    expect(blocked.pos.x).toBeLessThanOrEqual(400 - PLAYER_BASE_ATTRS.radius)
    expect(blocked.pos.x).toBeGreaterThan(370)

    run(world, { move: { x: 1, y: 1 } }, 30)
    expect(getPlayer(world).pos.y).toBeGreaterThan(540)
  })

  it('does not move without intent', () => {
    const world = makeWorld(300, 540)
    run(world, { move: { x: 0, y: 0 } }, 60)

    expect(getPlayer(world).pos).toEqual({ x: 300, y: 540 })
  })
})