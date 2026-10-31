import { describe, it, expect } from 'vitest'
import { CARD_REGISTRY, cardPrice } from '../../src/content/cards'
import { LEGACY_V4_REGISTRY } from '../../src/content/legacyCardsV4'
import { LEGACY_V1_REGISTRY, LEGACY_V2_REGISTRY } from '../../src/content/legacyCards'
import { LEGACY_V3_REGISTRY } from '../../src/content/legacyCardsV3'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createWorld, getPlayer } from '../../src/core/world'
import { serializeWorld, restoreWorld } from '../../src/core/serialization'
import { buyCard, sellCard } from '../../src/core/progress'
import { readCheckpoint, CURRENT_BALANCE_VERSION } from '../../src/app/checkpoints'
describe('1.5 price growth and historical payment records', () => {
  it('computes every price from its base at 1.5 growth, without cumulative rounding', () => {
    expect(Array.from({ length: 6 }, (_, i) => cardPrice(10, i + 1))).toEqual([10, 15, 23, 34, 51, 76])
    for (const card of CARD_REGISTRY.all()) for (const level of [1, 2, 8, 30]) expect(card.priceFn(level)).toBe(Math.round(card.priceFn(1) * 1.5 ** (level - 1)))
  })
  it('freezes every older balance generation at its original 1.6 growth', () => {
    for (const registry of [LEGACY_V1_REGISTRY, LEGACY_V2_REGISTRY, LEGACY_V3_REGISTRY, LEGACY_V4_REGISTRY]) {
      expect(registry.get('gun-damage')!.priceFn(2)).toBe(16); expect(registry.get('gun-damage')!.priceFn(3)).toBe(26)
    }
  })
  it.each([true, false])('preserves old paid records (explicit=%s), uses new future prices and refunds the old real payment', (explicit) => {
    const w = createWorld({ seed: 42, registry: LEGACY_V4_REGISTRY, economy: DEFAULT_ECONOMY, playerAttrs: PLAYER_BASE_ATTRS,
      room: { id: 'save', kind: 'safe', bounds: { x: 0, y: 0, width: 3200, height: 1800 }, walls: [], spawns: [], pickups: [], entry: { x: 500, y: 500 } } })
    w.shards = 10000; for (let i = 0; i < 3; i++) buyCard(w, 'gun-damage')
    if (!explicit) delete w.purchases[0]!.paid
    const saved = readCheckpoint(JSON.stringify({ format: 'prism-save', version: 1, balanceVersion: 4, savedAt: '2026-10-31T00:00:00Z', mode: 'dungeon', initialSeed: w.seed, restarts: 0, roomIndex: 0, world: serializeWorld(w, true) }))
    expect(saved.balanceVersion).toBe(CURRENT_BALANCE_VERSION); expect(saved.world.purchases[0]!.paid).toEqual([10, 16, 26])
    const copy = restoreWorld(saved.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS)), funds = copy.shards
    expect(getPlayer(copy).attrs.damage).toBe(16); expect(sellCard(copy, 'gun-damage')).toBe(true); expect(copy.shards - funds).toBe(15)
    const before = copy.shards; expect(buyCard(copy, 'gun-damage').ok).toBe(true); expect(before - copy.shards).toBe(23)
  })
})
