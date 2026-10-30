import { describe, expect, it } from 'vitest'
import { createEndlessMode, ENDLESS_RULES, endlessCount, endlessFactor, endlessReward, rollEndlessEnemy, worldSeed } from '../../src/app/modes/endless'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createRng } from '../../src/core/rng'
import { createWorld, getPlayer } from '../../src/core/world'
import { step } from '../../src/core/simulation'
import { hashWorld } from '../../src/core/hash'
import { circleIntersectsRect } from '../../src/core/collision'
import { applyDamage } from '../../src/core/systems/damage'
import { EXIT_RECT } from '../../src/core/systems/room'
function setup(seed = 777) {
  const mode = createEndlessMode(), world = createWorld({ seed, registry: CARD_REGISTRY, playerAttrs: PLAYER_BASE_ATTRS, economy: DEFAULT_ECONOMY, room: mode.room() })
  mode.initialize(world)
  const tick = () => { getPlayer(world).iframesTicks = 100000; step(world, new Map([[getPlayer(world).id, { move: { x: 0, y: 0 }, fire: false }]])); mode.afterStep(world) }
  const enter = () => { getPlayer(world).pos = { x: 1600, y: 1200 }; tick() }
  return { mode, world, tick, enter }
}
describe('seeded endless generation', () => {
  it('reproduces geometry, resources, enemy stats and inputs for the same seed', () => {
    const a = setup(), b = setup()
    expect(hashWorld(a.world)).toBe(hashWorld(b.world))
    a.enter(); b.enter()
    for (let i = 0; i < 90; i++) { a.tick(); b.tick() }
    expect(hashWorld(a.world)).toBe(hashWorld(b.world)); expect(a.mode.state(a.world)).toEqual(b.mode.state(b.world))
    const other = setup(778)
    expect(other.world.pendingSpawns).not.toEqual(setup().world.pendingSpawns)
  })
  it('has a bounded population only generated once on finite floors', () => {
    const { mode, world, enter, tick } = setup(); expect(world.pendingSpawns).toHaveLength(endlessCount(1)); expect(world.room.exit).toBeNull()
    enter(); const ids = [...world.actors.keys()]
    for (let i = 0; i < 10; i++) tick()
    expect([...world.actors.keys()]).toEqual(ids)
    world.pickups = []
    const before = world.shards
    for (const actor of world.actors.values()) if (actor.team === 'enemy') actor.alive = false
    tick(); expect(world.room.exit).toEqual(EXIT_RECT); expect(world.shards).toBe(before)
    expect(mode.state(world).alive).toBe(0)
    getPlayer(world).pos = { x: 1600, y: 120 }; tick()
    expect(mode.state(world).floor).toBe(2); expect(world.pendingSpawns).toHaveLength(endlessCount(2)); expect(world.room.exit).toBeNull()
  })
  it('checks each finite-floor stat against its floor reference bound', () => {
    for (const floor of [1, 7, 31]) {
      const rng = createRng(100)
      for (let i = 0; i < 500; i++) {
        const e = rollEndlessEnemy(floor, rng, false), g = ENDLESS_RULES.growth, cap = ENDLESS_RULES.finiteMax
        for (const [key, base, growth] of [['maxHp', 28, g.maxHp], ['damage', 6, g.damage], ['armor', 12, g.armor], ['speed', 150, g.speed], ['bulletSpeed', 380, g.bulletSpeed], ['fireRate', 0.6, g.fireRate], ['range', 750, g.range]] as const)
          expect(e.attrs[key]).toBeLessThanOrEqual(base * growth ** (floor - 1) * cap + 1e-6)
      }
    }
  })
  it('retains a rare upper tail on open floors and exponential floor scaling', () => {
    const rng = createRng(2); let largest = 0, finiteLargest = 0
    for (let i = 0; i < 30000; i++) { largest = Math.max(largest, endlessFactor(rng, true)); finiteLargest = Math.max(finiteLargest, endlessFactor(rng, false)) }
    expect(largest).toBeGreaterThan(10); expect(finiteLargest).toBeLessThanOrEqual(2.5)
    const low = rollEndlessEnemy(5, createRng(88), true), high = rollEndlessEnemy(15, createRng(88), true)
    expect(high.attrs.maxHp / low.attrs.maxHp).toBeCloseTo(1.18 ** 10)
    expect(high.attrs.damage / low.attrs.damage).toBeCloseTo(1.13 ** 10)
  })
  it('keeps generated anchors out of walls and away from entry', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { world } = setup(seed)
      for (const spawn of world.pendingSpawns) {
        expect(world.room.walls.some((wall) => circleIntersectsRect(spawn.pos.x, spawn.pos.y, spawn.attrs.radius, wall))).toBe(false)
        expect(Math.hypot(spawn.pos.x - world.room.entry.x, spawn.pos.y - world.room.entry.y)).toBeGreaterThanOrEqual(550)
      }
    }
  })
  it('normalizes numeric and text world seeds reproducibly', () => {
    expect(worldSeed('20261030')).toBe(20261030); expect(worldSeed('PRISM')).toBe(worldSeed('PRISM'))
    expect(worldSeed('')).toBe(20261030)
    expect(worldSeed(String(worldSeed('PRISM')))).toBe(worldSeed('PRISM'))
    expect(worldSeed('PRISM')).not.toBe(worldSeed('prism'))
  })
})
describe('open floors and declining rewards', () => {
  it('opens every fifth floor immediately and allows leaving without kills', () => {
    const { mode, world, tick } = setup()
    for (let i = 0; i < 4; i++) mode.advance(world)
    expect(mode.state(world)).toMatchObject({ floor: 5, open: true })
    expect(world.room.exit).toEqual(EXIT_RECT)
    getPlayer(world).pos = { x: 1600, y: 120 }; tick()
    expect(mode.state(world).floor).toBe(6); expect(world.stats.kills).toBe(0); expect(world.room.exit).toBeNull()
  })
  it('replaces dead enemies with lower-reward enemies without respawning room loot', () => {
    const run = setup(); const { mode, world, tick, enter } = run
    for (let i = 0; i < 4; i++) mode.advance(world)
    const loot = world.pickups.map((p) => p.id)
    enter(); const enemy = [...world.actors.values()].find((a) => a.team === 'enemy')!
    enemy.alive = false; tick(); expect(world.actors.has(enemy.id)).toBe(false); expect(mode.state(world).pending).toBe(1)
    world.tick += ENDLESS_RULES.respawnTicks; tick()
    expect(mode.state(world)).toMatchObject({ respawned: 1, pending: 0, alive: endlessCount(5) })
    const replacement = [...world.actors.values()].at(-1)!
    expect(replacement.rewardMultiplier).toBeCloseTo(endlessReward(1, endlessCount(5)))
    expect(world.pickups.map((p) => p.id)).toEqual(loot)
    expect(world.room.exit).toEqual(EXIT_RECT)
  })
  it('decays rewards toward zero and preserves the multiplier on income', () => {
    expect(endlessReward(10000, 10)).toBeLessThan(1e-5)
    const { world, enter } = setup(); enter(); world.pickups = []
    const enemy = [...world.actors.values()].find((a) => a.team === 'enemy')!
    const copy = { ...enemy, id: 800, rewardMultiplier: 0.25, hp: 1000, attrs: { ...enemy.attrs, armor: 0 } }
    world.actors.set(copy.id, copy); const start = world.shards
    applyDamage(world, { targetId: copy.id, sourceId: getPlayer(world).id, sourceTeam: 'player', raw: 20, penetration: 0, isCore: false })
    expect(world.shards - start).toBeCloseTo(20 * world.economy.tierRate[copy.tier] * 0.25)
  })
})
