import { describe, expect, it } from 'vitest'
import { ALL_CARDS, CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { resolveAttrs } from '../../src/core/cards'
import { combatAttrs } from '../../src/core/combat'
import { buyCard, sellCard, listCardStates } from '../../src/core/progress'
import { emitProjectile, updateWeapons } from '../../src/core/systems/weapons'
import { toSnapshot } from '../../src/core/snapshot'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { tryActivateSkill } from '../../src/core/systems/skills'
import { createWorld, createActor, getPlayer } from '../../src/core/world'
import type { Purchase } from '../../src/core/cards'
import type { AttrSet } from '../../src/core/attrs'
function setup(purchases: Purchase[] = [], overrides: Partial<AttrSet> = {}) {
  const attrs = { ...resolveAttrs(PLAYER_BASE_ATTRS, purchases, CARD_REGISTRY), ...overrides }
  const world = createWorld({ seed: 17, playerAttrs: attrs, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY,
    room: { id: 'range', kind: 'combat', bounds: { x: 0, y: 0, width: 100000, height: 100000 }, walls: [], spawns: [], entry: { x: 40000, y: 40000 } } })
  const player = getPlayer(world)
  const emit = () => { emitProjectile(world, player, 0, player.pos); return world.projectiles.at(-1)! }
  return { world, player, emit }
}

describe('homing and flying-sword ballistics', () => {
  it('launches at one fifth speed and never accelerates past the resolved bullet speed', () => {
    const { world, player, emit } = setup([], { homing: 1, range: 10000 })
    const bullet = emit()
    expect(bullet.vel.x).toBe(140); expect(bullet.homingTurn).toBeCloseTo(1.6)
    expect(bullet.cruiseSpeed).toBe(player.attrs.bulletSpeed)
    for (let i = 0; i < 240; i++) updateProjectiles(world, 1 / 60)
    expect(Math.hypot(bullet.vel.x, bullet.vel.y)).toBeCloseTo(700)
  })
  it('turns no faster than the configured angular speed', () => {
    const { world, player, emit } = setup([], { homing: 1 })
    const target = createActor(world, { team: 'enemy', tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false,
      attrs: PLAYER_BASE_ATTRS, pos: { x: player.pos.x, y: player.pos.y + 5000 } })
    player.lockTargetId = target.id
    const bullet = emit(); updateProjectiles(world, 0.1)
    expect(Math.atan2(bullet.vel.y, bullet.vel.x)).toBeCloseTo(0.16)
  })
  it('makes sniper bullets faster with the same angular steering and a naturally larger turning radius', () => {
    const ordinary = setup([{ id: 'homing', level: 1 }]), sniper = setup([{ id: 'homing', level: 1 }, { id: 'precision-stance', level: 1 }])
    const a = ordinary.emit(), b = sniper.emit()
    expect(sniper.player.attrs.bulletSpeed).toBe(2100)
    expect(b.homingTurn).toBe(a.homingTurn)
    expect(b.vel.x / b.homingTurn!).toBeCloseTo(3 * a.vel.x / a.homingTurn!)
    expect(sniper.player.attrs.maxProjectiles).toBe(1)
    expect(sniper.emit()).toBe(b); expect(sniper.world.projectiles).toHaveLength(1)
  })
  it('gives suspension a gentler speed reduction, more path range and longer homing flight', () => {
    const plain = setup([{ id: 'homing', level: 1 }])
    const sword = setup([{ id: 'homing', level: 1 }, { id: 'suspension', level: 3 }])
    expect(sword.player.attrs.range).toBeCloseTo(plain.player.attrs.range * 1.45)
    expect(sword.player.attrs.bulletSpeed).toBeCloseTo(700 / 1.9)
    const a = plain.emit(), b = sword.emit()
    expect(b.homingTurn).toBe(a.homingTurn); expect(b.vel.x).toBeCloseTo(140 / 1.9)
    expect(b.travelLeft).toBeCloseTo(sword.player.attrs.range); expect(b.rangeBudget).toBe(b.travelLeft)
    const duration = (run: typeof plain) => {
      let ticks = 0
      while (run.world.projectiles.length && ticks < 2000) { updateProjectiles(run.world, 1 / 60); ticks++ }
      return ticks
    }
    expect(duration(sword)).toBeGreaterThan(duration(plain))
    expect(a.travelLeft).toBe(0); expect(b.travelLeft).toBe(0)
  })
  it('removes suspension speed and range modifiers together when sold', () => {
    const { world, player } = setup(); world.shards = 1000
    buyCard(world, 'homing'); const baseline = { ...player.attrs }
    expect(buyCard(world, 'suspension').ok).toBe(true)
    expect(player.attrs.bulletSpeed).toBeCloseTo(baseline.bulletSpeed / 1.3)
    expect(player.attrs.range).toBeCloseTo(baseline.range * 1.15)
    expect(listCardStates(world).find((c) => c.id === 'suspension')?.summary).toContain('射程 ×1.3')
    expect(sellCard(world, 'suspension')).toBe(true); expect(player.attrs).toEqual(baseline)
  })
})

describe('sniper suppresses burst upgrades', () => {
  it.each([['precision-stance', 'burst'], ['burst', 'precision-stance']])('ignores burst bonuses and costs regardless of purchase order: %s first', (first, second) => {
    const { world, player } = setup(); world.shards = 100000
    buyCard(world, first); buyCard(world, second); buyCard(world, 'burst')
    expect(player.attrs.damage).toBe(PLAYER_BASE_ATTRS.damage)
    expect(player.attrs.range).toBeCloseTo(PLAYER_BASE_ATTRS.range * 1.6)
    expect(player.attrs.burstCount).toBe(1)
    player.intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true }; updateWeapons(world)
    expect(world.projectiles).toHaveLength(1); expect(player.burstRemaining).toBe(0)
    player.intent = { ...player.intent, fire: false }; world.projectiles = []
    for (let i = 0; i < 180; i++) updateWeapons(world)
    expect(world.projectiles).toHaveLength(0)
    sellCard(world, 'precision-stance')
    expect(player.attrs.burstCount).toBe(3)
    expect(player.attrs.damage).toBeCloseTo(PLAYER_BASE_ATTRS.damage / 1.4)
    expect(player.attrs.range).toBeCloseTo(PLAYER_BASE_ATTRS.range / 1.2)
    player.intent = { ...player.intent, fire: true }; updateWeapons(world)
    player.intent = { ...player.intent, fire: false }
    for (let i = 0; i < 8; i++) updateWeapons(world)
    expect(world.projectiles).toHaveLength(3)
  })
  it('cancels an already queued burst when sniper is bought and does not revive it on sale', () => {
    const { world, player } = setup(); world.shards = 10000; buyCard(world, 'burst')
    player.intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true }; updateWeapons(world)
    expect(player.burstRemaining).toBe(1)
    buyCard(world, 'precision-stance'); expect(player.burstRemaining).toBe(0)
    sellCard(world, 'precision-stance'); world.projectiles = []; player.intent = { ...player.intent, fire: false }
    for (let i = 0; i < 180; i++) updateWeapons(world)
    expect(world.projectiles).toHaveLength(0)
  })
})

describe('range is actual path length', () => {
  it('exposes the remaining distance fraction to rendering independently of elapsed time', () => {
    const { world, emit } = setup([], { bulletSpeed: 140, range: 280 }); const bullet = emit()
    expect(toSnapshot(world).projectiles[0]!.rangeRatio).toBe(1)
    updateProjectiles(world, 1)
    expect(toSnapshot(world).projectiles[0]!.rangeRatio).toBeCloseTo(0.5)
    bullet.travelLeft = 0
    expect(toSnapshot(world).projectiles[0]!.rangeRatio).toBe(0)
  })
  it.each([70, 700, 2100])('flies the same distance at speed %s but takes a different time', (speed) => {
    const { world, player, emit } = setup([], { bulletSpeed: speed, range: 280 })
    const bullet = emit(); let ticks = 0
    while (world.projectiles.length && ticks < 1000) { updateProjectiles(world, 1 / 60); ticks++ }
    expect(bullet.pos.x - player.pos.x).toBeCloseTo(280)
    expect(bullet.travelLeft).toBe(0); expect(ticks / 60).toBeCloseTo(280 / speed, 1)
  })
  it('spends range on curved flight rather than displacement from the muzzle', () => {
    const { world, player, emit } = setup([], { homing: 1, range: 1500 })
    const target = createActor(world, { team: 'enemy', tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false,
      attrs: PLAYER_BASE_ATTRS, pos: { x: player.pos.x, y: player.pos.y + 5000 } })
    player.lockTargetId = target.id
    const bullet = emit(); let length = 0
    for (let i = 0; i < 1000 && world.projectiles.length; i++) {
      updateProjectiles(world, 1 / 60)
      length += Math.hypot(bullet.pos.x - bullet.prevPos.x, bullet.pos.y - bullet.prevPos.y)
    }
    expect(length).toBeCloseTo(1500)
    expect(Math.hypot(bullet.pos.x - player.pos.x, bullet.pos.y - player.pos.y)).toBeLessThan(length - 10)
    expect(world.projectiles).toHaveLength(0)
  })
  it('spends only actual movement inside a slowing mine field', () => {
    const { world, emit } = setup([], { bulletSpeed: 700, range: 280 })
    const bullet = emit()
    world.mines.push({ id: 50, ownerId: 99, team: 'enemy', pos: { ...bullet.pos }, bodyRadius: 1, triggerRadius: 1, blastRadius: 1,
      slowRadius: 10000, slowMultiplier: 4, damage: 0, hp: 1, fuseTicks: null, ignoreBullets: true })
    updateProjectiles(world, 0.2)
    expect(bullet.pos.x - bullet.prevPos.x).toBeCloseTo(35)
    expect(bullet.travelLeft).toBeCloseTo(245)
  })
  it('moves very slow bullets and removes even a tiny exhausted range remainder', () => {
    const { world, emit } = setup([], { bulletSpeed: 1e-5, range: 1e-7 })
    const bullet = emit(); updateProjectiles(world, 1)
    expect(bullet.pos.x).toBeGreaterThan(bullet.prevPos.x)
    expect(bullet.travelLeft).toBe(0); expect(world.projectiles).toHaveLength(0)
  })
})

describe('formula-driven growth cards', () => {
  it('caps only pure binary mechanisms and lets numeric effects and descriptions grow', () => {
    expect(ALL_CARDS.filter((card) => card.maxLevel !== undefined).map((card) => card.id).sort())
      .toEqual(['auto-aim', 'auto-fire', 'grenade', 'mine-ignore', 'ricochet'])
    for (const card of ALL_CARDS.filter((card) => card.maxLevel === undefined)) {
      const a = card.effectFn(30, PLAYER_BASE_ATTRS), b = card.effectFn(31, PLAYER_BASE_ATTRS)
      expect(b, card.id).not.toEqual(a)
      expect(card.summary?.(31), card.id).not.toBe(card.summary?.(30))
      expect(card.priceFn(31), card.id).toBeGreaterThan(card.priceFn(30))
      expect(Object.values(b).every(Number.isFinite), card.id).toBe(true)
    }
  })
  it('keeps generated stance text and cumulative modifiers aligned across levels', () => {
    const card = CARD_REGISTRY.get('precision-stance')!, attrs = card.effectFn(3, PLAYER_BASE_ATTRS)
    expect(attrs.bulletSpeed).toBe(4900); expect(attrs.range).toBeCloseTo(1568)
    expect(card.summary?.(3)).toContain('弹速 ×7')
    expect(card.summary?.(3)).toContain('射程 ×2.8')
    expect(card.summary?.(3)).not.toContain('追踪操控')
  })
  it('scales active skills through the same rules used by their generated descriptions', () => {
    const { world, player } = setup([{ id: 'rage', level: 3 }, { id: 'dash', level: 3 }])
    player.skillSlots = ['rage', 'dash']
    expect(tryActivateSkill(world, player, 0)).toBe(true)
    const active = combatAttrs(player)
    expect(active.damage).toBe(25); expect(active.armor).toBe(90); expect(active.lifesteal).toBeCloseTo(0.3)
    expect(CARD_REGISTRY.get('rage')!.summary?.(3)).toContain('伤害与地雷伤害 ×2.5')
    expect(tryActivateSkill(world, player, 1)).toBe(true)
    expect(combatAttrs(player).speed).toBeCloseTo(330 * 6.4)
    expect(CARD_REGISTRY.get('dash')!.summary?.(3)).toContain('移速 ×6.4')
  })
  it('shows a toggle current effect at its cap and keeps a high-level price finite or rejects it', () => {
    const { world } = setup(); world.shards = 1e6; buyCard(world, 'auto-aim')
    expect(listCardStates(world).find((card) => card.id === 'auto-aim')?.availability).toBe('max-level')
    world.purchases.push({ id: 'gun-damage', level: 10000, paid: [] })
    const before = world.shards
    expect(buyCard(world, 'gun-damage')).toMatchObject({ ok: false, reason: 'numeric-range' })
    expect(world.shards).toBe(before)
  })
})
