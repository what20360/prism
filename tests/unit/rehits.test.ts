import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY, ALL_CARDS } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { createWorld, createActor, getPlayer } from '../../src/core/world'
import { resolveProjectilePath } from '../../src/core/systems/hits'
import { emitProjectile } from '../../src/core/systems/weapons'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { buyCard, sellCard } from '../../src/core/progress'
import { applyDamage } from '../../src/core/systems/damage'
import { toSnapshot } from '../../src/core/snapshot'
import type { AttrSet } from '../../src/core/attrs'
function setup(attrs: Partial<AttrSet> = {}) {
  const world = createWorld({ seed: 9, registry: CARD_REGISTRY, playerAttrs: { ...PLAYER_BASE_ATTRS, pierce: 8, ...attrs }, economy: DEFAULT_ECONOMY,
    room: { id: 'rehit', kind: 'combat', bounds: { x: 0, y: 0, width: 600, height: 1000 }, walls: [], spawns: [], pickups: [], entry: { x: 50, y: 50 } } })
  const player = getPlayer(world), target = createActor(world, { team: 'enemy', tier: 'normal', behavior: 'turret', hasCore: false, contactDamage: 0,
    attrs: { ...PLAYER_BASE_ATTRS, radius: 20, maxHp: 1000, speed: 0, fireRate: 0 }, pos: { x: 300, y: 500 } })
  emitProjectile(world, player, 0, { x: 100, y: 500 }); const bullet = world.projectiles[0]!
  const trace = (fromX: number, toX: number) => { const from = { x: fromX, y: 500 }, to = { x: toX, y: 500 }; bullet.pos = to; return resolveProjectilePath(world, bullet, from, to) }
  return { world, player, target, bullet, trace }
}
describe('separation-based projectile contacts', () => {
  it('damages a returning bullet target again but not continuously while inside it', () => {
    const { target, trace, bullet } = setup()
    trace(100, 300); expect(target.hp).toBe(990)
    for (let i = 0; i < 10; i++) trace(300, 300)
    trace(300, 320); trace(320, 400); expect(target.hp).toBe(990)
    trace(400, 300); expect(target.hp).toBe(980); expect(bullet.pierceLeft).toBe(6)
  })
  it('supports hitting the same actor before and after a wall bounce within one tick', () => {
    const { world, target, bullet } = setup({ bulletSpeed: 1000, bulletSize: 5, ricochet: 1, range: 2000 })
    updateProjectiles(world, 0.9)
    expect(target.hp).toBe(980); expect(bullet.pierceLeft).toBe(5)
  })
  it('boosts speed, homing cruise speed and remaining path budget after each surviving penetration', () => {
    const { bullet, trace } = setup({ pierceBoost: 2, homing: 1 })
    const initialSpeed = bullet.vel.x, range = bullet.travelLeft
    trace(100, 400)
    expect(bullet.vel.x).toBeCloseTo(initialSpeed * 1.24); expect(bullet.cruiseSpeed).toBeCloseTo(700 * 1.24)
    expect(bullet.travelLeft).toBe(range + 400)
    trace(400, 100)
    expect(bullet.vel.x).toBeCloseTo(initialSpeed * 1.24 ** 2); expect(bullet.travelLeft).toBe(range + 800)
  })
  it('restores a proportional amount of range feedback after penetrating a target', () => {
    const { world, bullet, trace } = setup({ pierceBoost: 2, range: 600 })
    bullet.travelLeft = 120
    expect(toSnapshot(world).projectiles[0]!.rangeRatio).toBeCloseTo(0.2)
    trace(100, 400)
    expect(bullet.rangeBudget).toBe(1000)
    expect(toSnapshot(world).projectiles[0]!.rangeRatio).toBeCloseTo(520 / 1000)
  })
  it('does not award growth to a projectile with no penetration left', () => {
    const { bullet, trace } = setup({ pierce: 1, pierceBoost: 2 })
    const speed = bullet.vel.x, range = bullet.travelLeft
    expect(trace(100, 400)).toBe('stopped'); expect(bullet.vel.x).toBe(speed); expect(bullet.travelLeft).toBe(range)
  })
})
describe('universal card resale and diminished income', () => {
  it('makes every production card sellable and preserves owned prerequisite dependents', () => {
    expect(ALL_CARDS.every((card) => card.resellable)).toBe(true)
    const { world, player } = setup(); world.shards = 10000
    buyCard(world, 'gun-pierce'); buyCard(world, 'pierce-drive')
    expect(sellCard(world, 'gun-pierce')).toBe(true); expect(player.attrs.pierceBoost).toBe(1)
    expect(sellCard(world, 'pierce-drive')).toBe(true); expect(player.attrs.pierceBoost).toBe(0)
  })
  it('scales taking-damage income using a projectile multiplier even after its source is removed', () => {
    const { world, player } = setup(); const before = world.shards
    applyDamage(world, { targetId: player.id, sourceId: 99999, sourceTeam: 'enemy', raw: 10, penetration: 0, isCore: false, rewardMultiplier: 0.1 })
    expect(world.shards - before).toBeCloseTo(10 * DEFAULT_ECONOMY.takenRate * 0.1)
  })
})
