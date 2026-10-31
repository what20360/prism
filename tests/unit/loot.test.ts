import { describe, expect, it } from 'vitest'
import { killDropProbability, rollLootAmount, packLoot, spawnLoot, LOOT_DENOMINATIONS } from '../../src/core/loot'
import { createRng } from '../../src/core/rng'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { createActor, createWorld, getPlayer, type Pickup } from '../../src/core/world'
import { applyDamage } from '../../src/core/systems/damage'
import { updatePickups } from '../../src/core/systems/pickups'
import { restoreWorld, serializeWorld } from '../../src/core/serialization'
import { createDuelMatch } from '../../src/app/modes/duel'
import { hashWorld } from '../../src/core/hash'

function arena(level = 0, maxHp = 1000, rewardMultiplier = 1) {
  const w = createWorld({ seed: 4, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY,
    playerAttrs: { ...PLAYER_BASE_ATTRS, mineShardChance: level, bloodOrbChance: level },
    room: { id: 'loot', kind: 'combat', bounds: { x: 0, y: 0, width: 2000, height: 1500 }, walls: [], pickups: [], spawns: [], entry: { x: 100, y: 400 } } })
  const e = createActor(w, { team: 'enemy', tier: 'normal', behavior: 'turret', hasCore: false, contactDamage: 0, rewardMultiplier, pos: { x: 600, y: 400 }, attrs: { ...PLAYER_BASE_ATTRS, maxHp } })
  return { w, e, p: getPlayer(w) }
}
function hit(w: ReturnType<typeof arena>['w'], id: number, raw: number) {
  applyDamage(w, { targetId: id, sourceId: 1, sourceTeam: 'player', raw, penetration: 0, isCore: false, kind: 'bullet' })
}
function total(pickups: readonly Pickup[], kind: Pickup['kind']) { return pickups.filter((p) => p.kind === kind).reduce((sum, p) => sum + p.value * (p.quantity ?? 1), 0) }
describe('probabilistic kill loot and denominations', () => {
  it('uses level, actual overkill and monster maximum health in the requested additive formula', () => {
    expect(killDropProbability(2, 6, 200)).toBeCloseTo(1)
    expect(killDropProbability(0, 0, 1000)).toBe(1)
    expect(killDropProbability(1, 0, 0)).toBe(0.1)
    expect(killDropProbability(0, 50, 0)).toBe(5)
  })
  it('keeps the integer part certain and only rolls one fractional unit reproducibly', () => {
    const a = createRng(55), b = createRng(55), results: number[] = []
    for (let i = 0; i < 10000; i++) { const n = rollLootAmount(a, 2.35); expect(n).toBe(rollLootAmount(b, 2.35)); results.push(n) }
    expect(new Set(results)).toEqual(new Set([2, 3]))
    expect(results.filter((n) => n === 3).length).toBeGreaterThan(3300); expect(results.filter((n) => n === 3).length).toBeLessThan(3700)
  })
  it('does not consume RNG for zero, integer and capped probabilities', () => {
    const rng = createRng(4), start = rng.state
    expect([0, 1, 20, 625, 1e300].map((p) => rollLootAmount(rng, p))).toEqual([0, 1, 20, 625, 625]); expect(rng.state).toBe(start)
  })
  it('packs every amount up to 625 exactly with large denominations first', () => {
    for (let amount = 0; amount <= 625; amount++) {
      const stacks = packLoot(amount)
      expect(stacks.reduce((sum, s) => sum + s.value * s.quantity, 0)).toBe(amount)
      expect(stacks.every((s, i) => LOOT_DENOMINATIONS.includes(s.value as 1) && s.quantity >= 1 && s.quantity <= 4 && (!i || s.value < stacks[i - 1]!.value))).toBe(true)
    }
    expect(packLoot(624)).toEqual([{ value: 125, quantity: 4 }, { value: 25, quantity: 4 }, { value: 5, quantity: 4 }, { value: 1, quantity: 4 }])
    expect(packLoot(625)).toEqual([{ value: 625, quantity: 1 }])
  })
  it('preserves large room-resource totals using stacks of the 625 denomination', () => {
    const amount = 12345; expect(packLoot(amount).reduce((sum, s) => sum + s.value * s.quantity, 0)).toBe(amount)
    expect(packLoot(amount)[0]).toEqual({ value: 625, quantity: 19 })
  })
  it('provides a baseline chance rather than a guaranteed item at low levels', () => {
    const { w, e } = arena(1, 1); hit(w, e.id, 1)
    expect(e.alive).toBe(false); expect(w.pickups).toHaveLength(0)
  })
  it('uses level zero in the formula, drops on death once and never on partial damage', () => {
    const { w, e } = arena(0, 1000); hit(w, e.id, 999); expect(w.pickups).toHaveLength(0)
    hit(w, e.id, 1); expect(total(w.pickups, 'shard')).toBe(1); expect(total(w.pickups, 'blood')).toBe(1)
    const state = w.rng.state; hit(w, e.id, 1e6); expect(w.rng.state).toBe(state); expect(w.pickups).toHaveLength(2)
  })
  it('subtracts block, armor and shield before counting overkill and preserves exact integral drops', () => {
    const { w, e } = arena(9, 100); e.attrs = { ...e.attrs, armor: 100, block: 10 }; e.shield = 5
    // (240 - 10) / 2 = 115; shield 5 + HP 100 leaves 10 overkill. p = .9 + 1 + .1 = 2.
    hit(w, e.id, 240); expect(total(w.pickups, 'shard')).toBe(2); expect(total(w.pickups, 'blood')).toBe(2)
  })
  it('limits each resource to 625 per kill and emits a single large piece', () => {
    const { w, e } = arena(1e6, 1000); hit(w, e.id, 1e10)
    expect(w.pickups.map((p) => [p.kind, p.value, p.quantity])).toEqual([['shard', 625, 1], ['blood', 625, 1]])
  })
  it('scales crystal expected units by enemy rewards before rolling and applies pickup gain once', () => {
    const { w, e, p } = arena(40, 1000, 0.4); p.attrs = { ...p.attrs, shardGain: 1.5 }; hit(w, e.id, 1000)
    expect(total(w.pickups, 'shard')).toBe(2); expect(total(w.pickups, 'blood')).toBe(5)
    w.pickups = w.pickups.filter((s) => s.kind === 'shard'); p.pos = { ...w.pickups[0]!.pos }; const before = w.shards
    updatePickups(w); expect(w.shards - before).toBe(3)
  })
  it('collects stack quantities, preserves old singleton values and validates stack imports', () => {
    const { w, p } = arena(); p.hp = 1
    w.pickups = [{ id: w.nextEntityId++, kind: 'blood', pos: { ...p.pos }, value: 5, quantity: 4, ttl: 60 }, { id: w.nextEntityId++, kind: 'shard', pos: { ...p.pos }, value: 3.5, ttl: 60 }]
    const data = serializeWorld(w, true), copy = restoreWorld(data, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    expect(hashWorld(copy)).toBe(hashWorld(w)); updatePickups(copy); expect(getPlayer(copy).hp).toBe(21); expect(copy.shards).toBe(3.5)
    const invalid = structuredClone(data) as unknown as { pickups: { quantity?: number }[] }; invalid.pickups[0]!.quantity = 0
    expect(() => restoreWorld(invalid, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))).toThrow()
  })
  it('reserves complete denomination packs in busy PvP scenes without evicting its own large pieces', () => {
    const match = createDuelMatch(4, 'resource'), w = match.world()
    for (let i = 0; i < 24; i++) spawnLoot(w, 'shard', { x: 100, y: 100 }, 1, 60)
    const firstId = w.nextEntityId; spawnLoot(w, 'blood', { x: 400, y: 400 }, 624, 60)
    expect(w.pickups).toHaveLength(24); expect(total(w.pickups.filter((p) => p.id >= firstId), 'blood')).toBe(624)
  })
  it('combines PvP monster base rewards and bonus crystals into one capped denomination pack', () => {
    const w = createDuelMatch(4, 'resource').world(), p = getPlayer(w)
    p.attrs = { ...p.attrs, mineShardChance: 1e6 }
    const e = createActor(w, { team: 'neutral', tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false, pos: { x: 1500, y: 800 }, attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1000 } })
    hit(w, e.id, 1000)
    expect(total(w.pickups, 'shard')).toBe(625); expect(w.pickups.filter((p) => p.kind === 'shard')).toHaveLength(1)
    expect(w.pickups.find((p) => p.kind === 'shard')?.value).toBe(625)
  })
})
