import { describe, expect, it } from 'vitest'
import { ALL_CARDS, CARD_REGISTRY } from '../../src/content/cards'
import { CARD_PURPOSES, RETIRED_CARDS } from '../../src/content/cardRoles'
import { LEGACY_V1_REGISTRY, LEGACY_V2_REGISTRY } from '../../src/content/legacyCards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { ENEMIES } from '../../src/content/enemies'
import { createWorld, createActor, getPlayer, allocateId } from '../../src/core/world'
import { resolveAttrs } from '../../src/core/cards'
import { buyCard, listCardStates, sellCard } from '../../src/core/progress'
import { restoreWorld, serializeWorld } from '../../src/core/serialization'
import { applyDamage, resolveContactDamage } from '../../src/core/systems/damage'
import { updatePickups } from '../../src/core/systems/pickups'
import { updateTimers } from '../../src/core/systems/timers'
import { emitProjectile } from '../../src/core/systems/weapons'
import { resolveHits } from '../../src/core/systems/hits'
import { tryPlaceMine } from '../../src/core/systems/mines'
import { readCheckpoint, CURRENT_BALANCE_VERSION } from '../../src/app/checkpoints'
import { readPreset } from '../../src/app/upgradePlans'
import { createDuelMatch } from '../../src/app/modes/duel'
function arena(registry = CARD_REGISTRY) {
  const w = createWorld({ seed: 9, playerAttrs: PLAYER_BASE_ATTRS, registry, economy: DEFAULT_ECONOMY,
    room: { id: 'audit', kind: 'safe', bounds: { x: 0, y: 0, width: 3200, height: 1800 }, walls: [], spawns: [], pickups: [], entry: { x: 300, y: 300 } } })
  w.shards = 100000; return w
}
function legacySave(registry = LEGACY_V2_REGISTRY) {
  const w = arena(registry)
  return { format: 'prism-save', version: 1, balanceVersion: registry === LEGACY_V2_REGISTRY ? 2 : 1, name: '保留的构筑', savedAt: '2026-10-31T00:00:00Z', mode: 'dungeon', initialSeed: 9, restarts: 0, roomIndex: 0, world: w }
}
describe('complete card audit', () => {
  it('accounts for all 54 old cards through explicit aliases alongside the new arsenal or explicit aliases with clear purposes', () => {
    expect(ALL_CARDS).toHaveLength(55); expect(new Set(ALL_CARDS.map((c) => c.name)).size).toBe(55)
    for (const old of LEGACY_V2_REGISTRY.all()) expect(CARD_REGISTRY.get(RETIRED_CARDS[old.id] ?? old.id)).toBeDefined()
    for (const c of ALL_CARDS) { expect(c.purpose).toBeTruthy(); expect(c.purpose).toBe(CARD_PURPOSES[c.id]) }
    for (const [oldId, id] of Object.entries(RETIRED_CARDS)) { expect(CARD_REGISTRY.get(oldId)).toBeUndefined(); expect(CARD_REGISTRY.get(id)).toBeDefined() }
  })
  it('blocks dead purchases in both budget seats while keeping live recovery purchases available', () => {
    const m = createDuelMatch(8, 'budget')
    for (const seat of [0, 1] as const) {
      const start = m.world().participants![seat + 1]!.shards
      for (const id of ['shard-gain', 'greed', 'miner', 'gourmet']) {
        expect(m.action(seat, { kind: 'buy', id })).toBe(false)
        expect(listCardStates(m.world(), seat + 1).find((c) => c.id === id)?.blockedReason).toContain('限额构筑')
      }
      expect(m.world().participants![seat + 1]!.shards).toBe(start)
      expect(m.action(seat, { kind: 'buy', id: 'lifesteal' })).toBe(true)
    }
  })
  it('requires active equipment for shield recovery and reactivates owned cards after re-equipping', () => {
    const w = arena(), p = getPlayer(w)
    expect(buyCard(w, 'shield-regen').ok).toBe(false); expect(buyCard(w, 'shield-steal').ok).toBe(false)
    buyCard(w, 'shield'); buyCard(w, 'shield-regen'); buyCard(w, 'shield-steal')
    expect(p.attrs.shieldRegen).toBeGreaterThan(0); expect(p.attrs.shieldSteal).toBeGreaterThan(0)
    p.shield = 0; p.outOfCombatTicks = 200; updateTimers(w); expect(p.shield).toBeGreaterThan(0)
    sellCard(w, 'shield'); expect(p.attrs.shieldRegen).toBe(0); expect(p.attrs.shieldSteal).toBe(0); expect(p.shield).toBe(0)
    expect(w.purchases.map((c) => c.id)).toContain('shield-regen'); buyCard(w, 'shield'); expect(p.attrs.shieldRegen).toBeGreaterThan(0)
  })
  it('rejects cooldown purchases with no skill and stops charging for burst or scatter under sniper', () => {
    const w = arena(), p = getPlayer(w)
    expect(buyCard(w, 'skill-cycle').ok).toBe(false); buyCard(w, 'dash'); expect(buyCard(w, 'skill-cycle').ok).toBe(true)
    buyCard(w, 'burst'); buyCard(w, 'scatter'); buyCard(w, 'precision-stance')
    const funds = w.shards; expect(p.attrs.multishot).toBe(1); expect(p.attrs.burstCount).toBe(1); expect(p.attrs.damage).toBeCloseTo(14.5)
    expect(buyCard(w, 'burst').ok).toBe(false); expect(buyCard(w, 'scatter').ok).toBe(false); expect(w.shards).toBe(funds)
    sellCard(w, 'precision-stance'); expect(p.attrs.multishot).toBe(3); expect(p.attrs.burstCount).toBe(2)
  })
  it('keeps every range expansion trigger inside the explosion and provides meaningful grenade durability', () => {
    const w = arena(), p = getPlayer(w)
    for (let i = 0; i < 8; i++) { buyCard(w, 'mine-radius'); expect(p.attrs.mineTriggerRadius).toBeLessThan(p.attrs.mineBlastRadius) }
    buyCard(w, 'grenade'); buyCard(w, 'sluggish'); tryPlaceMine(w, p)
    const mine = w.mines[0]!, hp = mine.hp; expect(hp).toBeGreaterThan(10); p.pos = { x: 300, y: 700 }
    const enemy = createActor(w, { ...ENEMIES.turret!, team: 'enemy', attrs: ENEMIES.turret!.attrs, pos: { x: 700, y: 300 } })
    emitProjectile(w, enemy, Math.PI, { ...mine.pos }); resolveHits(w)
    expect(w.mines[0]!.hp).toBe(hp - enemy.attrs.damage)
  })
  it('applies shard gain once on pickup and preserves already-valued legacy resources', () => {
    const w = arena(), p = getPlayer(w); p.attrs = { ...p.attrs, mineShardChance: 1, shardGain: 1.5 }
    const target = createActor(w, { ...ENEMIES.turret!, attrs: { ...ENEMIES.turret!.attrs, maxHp: 20, armor: 0, block: 0 }, team: 'enemy', rewardMultiplier: 0.4, pos: { x: 500, y: 300 } })
    applyDamage(w, { targetId: target.id, sourceId: p.id, sourceTeam: 'player', raw: 10, penetration: 0, isCore: false, kind: 'mine' })
    expect(w.pickups).toHaveLength(0)
    applyDamage(w, { targetId: target.id, sourceId: p.id, sourceTeam: 'player', raw: 10, penetration: 0, isCore: false, kind: 'mine' })
    const drop = w.pickups[0]!; expect(drop.value).toBeCloseTo(0.8); p.pos = { ...drop.pos }
    const before = w.shards; updatePickups(w); expect(w.shards - before).toBeCloseTo(1.2)
    w.pickups.push({ id: allocateId(w), kind: 'shard', pos: { ...p.pos }, value: 6, ttl: 600, gainApplied: true }); const old = w.shards
    updatePickups(w); expect(w.shards - old).toBe(6)
  })
  it('counts distinct same-tick projectiles in PvP and retains independent melee contact protection', () => {
    const m = createDuelMatch(8, 'resource'), w = m.world(), host = w.actors.get(1)!, guest = w.actors.get(2)!
    emitProjectile(w, host, 0, guest.pos); emitProjectile(w, host, 0, guest.pos); resolveHits(w)
    expect(guest.hp).toBe(70)
    const mob = createActor(w, { ...ENEMIES.drifter!, team: 'neutral', attrs: ENEMIES.drifter!.attrs, pos: { ...guest.pos } })
    resolveContactDamage(w); const hp = guest.hp; resolveContactDamage(w); expect(guest.hp).toBe(hp)
    applyDamage(w, { targetId: guest.id, sourceId: host.id, sourceTeam: 'player', raw: 10, penetration: 0, isCore: false, kind: 'bullet' }); expect(guest.hp).toBe(hp - 10)
    for (let i = 0; i < 30; i++) updateTimers(w); mob.pos = { ...guest.pos }; resolveContactDamage(w); expect(guest.hp).toBe(hp - 10 - mob.contactDamage)
  })
})
describe('card consolidation compatibility', () => {
  it('merges ownership and paid history while retaining the unbought order beyond existing alias levels', () => {
    const saved = legacySave(), w = saved.world
    for (const id of ['shield', 'shield-cap', 'mine-radius', 'mine-radius', 'mine-field', 'core-stability', 'armor', 'armor', 'deflect', 'field-power']) expect(buyCard(w, id).ok).toBe(true)
    const p = getPlayer(w); p.hp = 31; p.shield = 5
    const paid = w.purchases.flatMap((x) => x.paid ?? []), before = serializeWorld(w)
    const loaded = readCheckpoint(JSON.stringify({ ...saved, world: before, plan: { enabled: true, targets: [{ id: 'mine-detection', level: 1 }, { id: 'mine-radius', level: 3 }] } }))
    expect(loaded.balanceVersion).toBe(CURRENT_BALANCE_VERSION); expect(loaded.name).toBe(saved.name); expect(loaded.world.shards).toBe(w.shards)
    expect(loaded.world.actors[0]!.hp).toBe(31); expect(loaded.world.actors[0]!.shield).toBe(5)
    expect(loaded.world.purchases.find((x) => x.id === 'mine-radius')?.level).toBe(3)
    expect(loaded.world.purchases.flatMap((x) => x.paid ?? []).sort((a, b) => a - b)).toEqual(paid.sort((a, b) => a - b))
    expect(loaded.plan?.targets).toEqual([{ id: 'mine-radius', level: 4 }, { id: 'mine-radius', level: 5 }])
    expect(readCheckpoint(JSON.stringify(loaded))).toEqual(loaded)
    const restored = restoreWorld(loaded.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS)), funds = restored.shards
    for (const purchase of [...restored.purchases]) for (let level = purchase.level; level > 0; level--) expect(sellCard(restored, purchase.id)).toBe(true)
    expect(restored.shards - funds).toBe(paid.reduce((sum, value) => sum + Math.floor(value * 0.6), 0))
  })
  it('migrates all old cards and refuses arbitrary changes to an old or current build', () => {
    const saved = legacySave(LEGACY_V1_REGISTRY), w = saved.world, p = getPlayer(w)
    w.purchases = LEGACY_V1_REGISTRY.all().map((c) => ({ id: c.id, level: 1, paid: [c.priceFn(1)] }))
    p.attrs = resolveAttrs(w.basePlayerAttrs, w.purchases, LEGACY_V1_REGISTRY); p.hp = Math.min(p.hp, p.attrs.maxHp)
    const data = { ...saved, world: serializeWorld(w) }; expect(() => readCheckpoint(JSON.stringify(data))).not.toThrow()
    data.world.actors[0]!.attrs.armor++; expect(() => readCheckpoint(JSON.stringify(data))).toThrow()
    expect(() => readCheckpoint(JSON.stringify({ ...data, balanceVersion: CURRENT_BALANCE_VERSION }))).toThrow()
  })
  it('converts old preset/favorite aliases and keeps the exact purchasing sequence on round-trip', () => {
    const preset = readPreset(JSON.stringify({ format: 'prism-build', version: 2, name: '雷场顺序', quickMode: 'planned', favorites: ['mine-radius', 'mine-field', 'shield-cap'],
      targets: [{ id: 'mine-radius', level: 1 }, { id: 'gun-damage', level: 1 }, { id: 'mine-field', level: 1 }, { id: 'mine-detection', level: 1 }, { id: 'shield-cap', level: 1 }, { id: 'shield', level: 1 }] }))
    expect(preset.targets).toEqual([{ id: 'mine-radius', level: 1 }, { id: 'gun-damage', level: 1 }, { id: 'mine-radius', level: 2 }, { id: 'mine-radius', level: 3 }, { id: 'shield', level: 1 }, { id: 'shield', level: 2 }])
    expect(preset.favorites).toEqual(['mine-radius', 'shield']); expect(readPreset(JSON.stringify(preset))).toEqual(preset)
  })
})
