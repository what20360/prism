import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { buildDungeon } from '../../src/content/dungeon'
import { applyRoom } from '../../src/core/dungeon'
import { updateRoom } from '../../src/core/systems/room'
import { updatePickups } from '../../src/core/systems/pickups'
import { buyCard, sellCard } from '../../src/core/progress'
import { circleIntersectsRect } from '../../src/core/collision'
import { createWorld, getPlayer } from '../../src/core/world'
function setup() { return createWorld({ seed: 88, room: buildDungeon()[0]!, registry: CARD_REGISTRY, playerAttrs: PLAYER_BASE_ATTRS, economy: DEFAULT_ECONOMY }) }
describe('room resources and configurable magnet', () => {
  it('places seeded resources once, keeps them alive and pays no clear bonus', () => {
    const world = setup(), same = setup(), pickups = structuredClone(world.pickups)
    expect(world.pickups).toEqual(same.pickups)
    expect(world.pickups.filter((p) => p.kind === 'blood').length).toBeGreaterThanOrEqual(1)
    expect(world.pickups.filter((p) => p.kind === 'shard').length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < 2000; i++) { updatePickups(world); updateRoom(world) }
    expect(world.pickups).toEqual(pickups); expect(world.shards).toBe(0)
    const ids = world.pickups.map((p) => p.id); applyRoom(world, buildDungeon()[1]!)
    expect(world.pickups.every((p) => !ids.includes(p.id))).toBe(true)
  })
  it('places resources outside wall geometry in every dungeon room', () => {
    const world = setup()
    for (const room of buildDungeon()) {
      applyRoom(world, room)
      for (const pickup of world.pickups) expect(world.room.walls.some((wall) => circleIntersectsRect(pickup.pos.x, pickup.pos.y, 22, wall))).toBe(false)
    }
  })
  it('requires a magnet card, respects its switch and still supports contact pickup', () => {
    const world = setup(), player = getPlayer(world); world.shards = 100
    const pos = { x: player.pos.x + 150, y: player.pos.y }
    world.pickups = [{ id: 90, kind: 'shard', pos: { ...pos }, value: 4, ttl: -1 }]
    updatePickups(world); expect(world.pickups[0]!.pos).toEqual(pos)
    buyCard(world, 'magnet'); expect(player.attrs.pickupRadius).toBe(180)
    player.intent = { move: { x: 0, y: 0 }, autoPickup: false }; updatePickups(world); expect(world.pickups[0]!.pos).toEqual(pos)
    player.intent = { move: { x: 0, y: 0 }, autoPickup: true }; updatePickups(world); expect(world.pickups[0]!.pos.x).toBeLessThan(pos.x)
    sellCard(world, 'magnet'); expect(player.attrs.pickupRadius).toBe(0)
    world.pickups[0]!.pos = { ...player.pos }; player.intent = { move: { x: 0, y: 0 }, autoPickup: false }
    const shards = world.shards; updatePickups(world); expect(world.shards).toBe(shards + 4); expect(world.pickups).toHaveLength(0)
  })
  it('does not waste blood or pull resources through walls', () => {
    const world = setup(), player = getPlayer(world); player.attrs = { ...player.attrs, pickupRadius: 300 }
    world.pickups = [{ id: 91, kind: 'blood', pos: { ...player.pos }, value: 10, ttl: -1 }]
    updatePickups(world); expect(world.pickups).toHaveLength(1)
    player.hp -= 5; updatePickups(world); expect(player.hp).toBe(player.attrs.maxHp); expect(world.pickups).toHaveLength(0)
    world.room.walls = [{ x: player.pos.x + 70, y: player.pos.y - 40, width: 40, height: 80 }]
    world.pickups = [{ id: 92, kind: 'shard', pos: { x: player.pos.x + 150, y: player.pos.y }, value: 4, ttl: -1 }]
    updatePickups(world); expect(world.pickups[0]!.pos.x).toBe(player.pos.x + 150)
  })
})
