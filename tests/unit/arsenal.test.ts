import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { LEGACY_V3_REGISTRY } from '../../src/content/legacyCardsV3'
import { ENEMIES } from '../../src/content/enemies'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { withMonsterTraits } from '../../src/content/monsterTraits'
import { ARSENAL_DEFAULTS, type AttrSet } from '../../src/core/attrs'
import { createActor, createWorld, getPlayer, type DamageType, type World } from '../../src/core/world'
import { ARSENAL_RULES, broodProfile } from '../../src/core/rules'
import { combatAttrs } from '../../src/core/combat'
import { createRng } from '../../src/core/rng'
import { buyCard, sellCard, listCardStates } from '../../src/core/progress'
import { applyDamage } from '../../src/core/systems/damage'
import { updateAi } from '../../src/core/systems/ai'
import { updateTimers } from '../../src/core/systems/timers'
import { fireElectric, fireLaserPulse } from '../../src/core/systems/energyWeapons'
import { emitProjectile, updateWeapons } from '../../src/core/systems/weapons'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { tryPlaceMine, updateMines } from '../../src/core/systems/mines'
import { restoreWorld, serializeWorld } from '../../src/core/serialization'
import { hashWorld } from '../../src/core/hash'
import { step } from '../../src/core/simulation'
import { readCheckpoint, CURRENT_BALANCE_VERSION } from '../../src/app/checkpoints'
import { createDuelMatch } from '../../src/app/modes/duel'
import { encodePacket, decodePacket } from '../../src/net/protocol'
import { toSnapshot } from '../../src/core/snapshot'
function arena(attrs: Partial<AttrSet> = {}, registry = CARD_REGISTRY) {
  const w = createWorld({ seed: 90, registry, economy: DEFAULT_ECONOMY, playerAttrs: { ...PLAYER_BASE_ATTRS, ...attrs },
    room: { id: 'arsenal', kind: 'combat', bounds: { x: 0, y: 0, width: 2000, height: 1500 }, walls: [], spawns: [], pickups: [], entry: { x: 100, y: 500 } } })
  w.shards = 100000; getPlayer(w).intent = { move: { x: 0, y: 0 }, fire: false, aim: { x: 1, y: 0 } }; return w
}
function enemy(w: World, x = 400, y = 500, attrs: Partial<AttrSet> = {}) {
  return createActor(w, { team: 'enemy', tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false, pos: { x, y },
    attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1000, damage: 0, fireRate: 0, speed: 0, radius: 20, ...attrs } })
}
function damage(w: World, id: number, raw: number, damageType: DamageType = 'physical') {
  applyDamage(w, { targetId: id, sourceId: 1, sourceTeam: 'player', raw, penetration: 0, isCore: false, kind: 'bullet', damageType })
}
describe('block, elemental damage and kill economy', () => {
  it('subtracts fixed block before armor and element resistance, with no rewards for full blocks', () => {
    const w = arena({ lifesteal: 1, mineShardChance: 1, bloodOrbChance: 1 }), p = getPlayer(w), e = enemy(w, 400, 500, { block: 10, armor: 100, electricResist: 100 })
    p.hp = 10; damage(w, e.id, 30, 'electric'); expect(e.hp).toBe(995); expect(p.hp).toBe(15)
    const before = w.shards; e.shockTicks = 0; damage(w, e.id, 10, 'electric')
    expect(e.hp).toBe(995); expect(e.shockTicks).toBe(0); expect(w.shards).toBe(before); expect(w.pickups).toHaveLength(0); expect(p.hp).toBe(15)
    expect(w.effects.at(-1)?.kind).toBe('block')
  })
  it('rolls only once on death and uses mitigated overkill for both resources', () => {
    const w = arena({ mineShardChance: 10, bloodOrbChance: 10 }), e = enemy(w, 400, 500, { maxHp: 20 })
    for (let i = 0; i < 19; i++) damage(w, e.id, 1)
    expect(w.pickups).toHaveLength(0); damage(w, e.id, 1)
    expect(w.pickups.map((p) => p.value)).toEqual([1, 1]); damage(w, e.id, 5000); expect(w.pickups).toHaveLength(2)
    const heavy = enemy(w, 800, 500, { maxHp: 10, shield: 5, block: 10, armor: 100 }); damage(w, heavy.id, 50)
    expect(w.pickups.slice(2).every((p) => p.value === 1 && p.quantity! >= 1 && p.quantity! <= 2)).toBe(true)
  })
  it('expires electric slowing and applies three non-recursive burn ticks through block', () => {
    const w = arena(), shock = enemy(w, 400, 500, { speed: 100 }), heat = enemy(w, 700, 500, { block: 1 })
    damage(w, shock.id, 10, 'electric'); expect(combatAttrs(shock).speed).toBe(80)
    damage(w, heat.id, 20, 'heat'); for (let i = 0; i < 60; i++) updateTimers(w)
    expect(combatAttrs(shock).speed).toBe(100); expect(heat.hp).toBe(975); expect(heat.burn).toBeUndefined()
    for (let i = 0; i < 60; i++) updateTimers(w); expect(heat.hp).toBe(975)
  })
})
describe('volatile enemies and seeded traits', () => {
  it('preserves death bullets emitted during swept hits and never emits a second burst', () => {
    const w = arena({ damage: 50 }), p = getPlayer(w)
    const e = createActor(w, { ...ENEMIES.bomber!, attrs: { ...ENEMIES.bomber!.attrs, maxHp: 10 }, team: 'enemy', pos: { x: 400, y: 500 } })
    emitProjectile(w, p, 0, e.pos); updateProjectiles(w, 1 / 60)
    expect(e.alive).toBe(false); expect(w.projectiles).toHaveLength(18)
    expect(w.projectiles.every((b) => b.ownerId === e.id && b.pos.x === e.pos.x && b.pos.y === e.pos.y)).toBe(true)
    damage(w, e.id, 500); expect(w.projectiles).toHaveLength(18)
  })
  it('telegraphs self destruction, hurts nearby players and pays no kill-card loot', () => {
    const w = arena({ maxHp: 1000, mineShardChance: 1, bloodOrbChance: 1 }), p = getPlayer(w)
    const e = createActor(w, { ...ENEMIES.bomber!, team: 'enemy', pos: { x: 300, y: 500 } })
    updateAi(w); expect(e.bombTicks).toBe(ARSENAL_RULES.bombFuse - 1); expect(e.alive).toBe(true); expect(p.hp).toBe(1000)
    for (let i = 1; i < ARSENAL_RULES.bombFuse; i++) updateAi(w)
    expect(e.alive).toBe(false); expect(p.hp).toBeCloseTo(1000 - e.attrs.damage * ARSENAL_RULES.bombDamage)
    expect(w.projectiles).toHaveLength(18); expect(w.pickups).toHaveLength(0); expect(w.stats.kills).toBe(0)
    updateAi(w); expect(w.projectiles).toHaveLength(18)
  })
  it('does not arm through a wall, and wall cover blocks an already armed blast', () => {
    const w = arena({ maxHp: 1000 }), p = getPlayer(w), e = createActor(w, { ...ENEMIES.bomber!, team: 'enemy', pos: { x: 300, y: 500 } })
    w.room.walls = [{ x: 190, y: 300, width: 20, height: 400 }]; updateAi(w); expect(e.bombTicks).toBeUndefined()
    e.bombTicks = 1; updateAi(w); expect(p.hp).toBe(1000); expect(e.alive).toBe(false)
  })
  it('reproduces composable traits and provides every modifier across a deterministic sample', () => {
    const a = createRng(8), b = createRng(8), seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const source = { ...ENEMIES.drifter!, pos: { x: 300, y: 300 } }, first = withMonsterTraits(source, a, 8)
      expect(first).toEqual(withMonsterTraits(source, b, 8)); first.traits?.forEach((t) => seen.add(t))
      if (first.traits?.includes('bark')) expect(first.attrs.block).toBeGreaterThan(source.attrs.block)
      expect(new Set(first.traits).size).toBe(first.traits?.length)
    }
    expect(seen).toEqual(new Set(['bark', 'swift', 'bulwark', 'storm', 'cinder', 'volatile']))
  })
  it('cannot turn a boss encounter into an automatic self-destruction clear', () => {
    const rng = createRng(77)
    for (let i = 0; i < 500; i++) expect(withMonsterTraits({ ...ENEMIES.boss!, pos: { x: 300, y: 500 } }, rng, 12).traits).not.toContain('volatile')
    const w = arena(), boss = createActor(w, { ...ENEMIES.boss!, traits: ['volatile'], team: 'enemy', pos: { x: 300, y: 500 } })
    for (let i = 0; i < 100; i++) updateAi(w)
    expect(boss.alive).toBe(true); expect(boss.bombTicks).toBeUndefined()
  })
})
describe('electric and laser weapon contracts', () => {
  it('spends pierce on targets and enhanced conduction, with leftover converted to damage', () => {
    const w = arena({ range: 1000, damage: 10, burstCount: 3, pierce: 6 }), targets = [300, 500, 700].map((x) => enemy(w, x))
    fireElectric(w, getPlayer(w), 0)
    expect(targets[0]!.hp).toBeCloseTo(1000 - 11.5); expect(targets[1]!.hp).toBeCloseTo(1000 - 11.5 * 0.85); expect(targets[2]!.hp).toBeCloseTo(1000 - 11.5 * 0.85)
    expect(w.traces).toHaveLength(3)
  })
  it('selects unique scatter roots with independent chains and respects walls and hop range', () => {
    const w = arena({ range: 1000, multishot: 3, burstCount: 4, pierce: 4 })
    const targets = [400, 500, 600].map((y) => enemy(w, 400, y)); fireElectric(w, getPlayer(w), 0)
    expect(targets.every((e) => e.hp < 1000)).toBe(true); expect(w.traces).toHaveLength(9)
    const blocked = arena({ range: 1000, burstCount: 3, pierce: 4 }), near = enemy(blocked, 300), far = enemy(blocked, 600)
    blocked.room.walls = [{ x: 450, y: 0, width: 20, height: 1500 }]; fireElectric(blocked, getPlayer(blocked), 0)
    expect(near.hp).toBeLessThan(1000); expect(far.hp).toBe(1000)
    const short = arena({ range: 300, burstCount: 3, pierce: 4 }), first = enemy(short, 350), beyond = enemy(short, 450)
    fireElectric(short, getPlayer(short), 0); expect(first.hp).toBeLessThan(1000); expect(beyond.hp).toBeLessThan(1000)
  })
  it('does not chain without pierce and the coil increases subsequent damage retention', () => {
    const w = arena({ range: 1000, burstCount: 3, pierce: 1 }), a = enemy(w, 300), b = enemy(w, 500)
    fireElectric(w, getPlayer(w), 0); expect(a.hp).toBeLessThan(1000); expect(b.hp).toBe(1000)
    const low = arena({ range: 1000, burstCount: 2, pierce: 2 }), high = arena({ range: 1000, burstCount: 2, pierce: 2, arcEfficiency: 2 })
    for (const run of [low, high]) { enemy(run, 300); enemy(run, 500); fireElectric(run, getPlayer(run), 0) }
    expect(high.traces![1]!.power).toBeGreaterThan(low.traces![1]!.power)
  })
  it('hits the laser line instantly, while walls stop the remaining line', () => {
    const w = arena({ range: 1000, damage: 20, pierce: 3 }), near = enemy(w, 300), far = enemy(w, 700)
    w.room.walls = [{ x: 500, y: 0, width: 20, height: 1500 }]; fireLaserPulse(w, getPlayer(w), 0)
    expect(near.hp).toBe(994); expect(far.hp).toBe(1000); expect(w.projectiles).toHaveLength(0); expect(w.traces?.[0]?.to.x).toBe(500)
  })
  it('reflects off a wall only when ricochet and enough pierce remain', () => {
    for (const pierce of [1, 3]) {
      const w = arena({ range: 1000, damage: 20, pierce, ricochet: 1 }), p = getPlayer(w); p.pos = { x: 100, y: 100 }
      const e = enemy(w, 400, 800); w.room.walls = [{ x: 600, y: 0, width: 20, height: 1500 }]
      fireLaserPulse(w, p, Math.PI / 4); expect(e.hp).toBe(pierce === 1 ? 1000 : 994)
    }
  })
  it('uses burst as longer laser duration with discrete pulses and no projectile queue', () => {
    for (const burstCount of [1, 2]) {
      const w = arena({ weapon: 2, damage: 20, range: 1000, burstCount }), p = getPlayer(w), e = enemy(w, 600)
      p.intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true }
      for (let i = 0; i < ARSENAL_RULES.laserTicks * burstCount; i++) updateWeapons(w)
      expect(e.hp).toBe(1000 - 12 * burstCount); expect(p.laserTicks).toBe(0); expect(p.burstRemaining).toBe(0); expect(w.projectiles).toHaveLength(0)
    }
  })
  it('enforces weapon exclusivity, specialization dependencies and clean switching', () => {
    const w = arena(), p = getPlayer(w)
    expect(buyCard(w, 'arc-coil').ok).toBe(false); expect(buyCard(w, 'weapon-electric').ok).toBe(true); buyCard(w, 'arc-coil')
    expect(p.attrs.arcEfficiency).toBe(1); const funds = w.shards; expect(buyCard(w, 'weapon-laser').ok).toBe(false); expect(w.shards).toBe(funds)
    expect(buyCard(w, 'burst').ok).toBe(false); buyCard(w, 'gun-pierce'); expect(buyCard(w, 'burst').ok).toBe(true)
    expect(listCardStates(w).find((c) => c.id === 'homing')?.blockedReason).toContain('实体弹')
    sellCard(w, 'weapon-electric'); expect(p.attrs.weapon).toBe(0); expect(p.attrs.arcEfficiency).toBe(0); buyCard(w, 'weapon-laser')
    p.laserTicks = 20; sellCard(w, 'weapon-laser'); expect(p.laserTicks).toBe(0); expect(p.attrs.weapon).toBe(0)
  })
  it('keeps extreme but finite specialization inputs out of Infinity combat/trace state', () => {
    for (const weapon of [1, 2]) {
      const w = arena({ weapon, damage: 1e307, arcEfficiency: 1000, laserPower: 1000, pierce: 1500 }), p = getPlayer(w), e = enemy(w, 400, 500, { maxHp: 1e307 })
      if (weapon === 1) fireElectric(w, p, 0); else fireLaserPulse(w, p, 0)
      expect(Number.isFinite(e.hp)).toBe(true); expect(Number.isFinite(w.stats.damageDealt)).toBe(true); expect(w.traces?.every((t) => Number.isFinite(t.power))).toBe(true)
      expect(() => restoreWorld(serializeWorld(w, true), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))).not.toThrow()
    }
  })
})
describe('multi-stage and child mines', () => {
  it('reduces per-pulse damage and emits fragments/children only after the last pulse', () => {
    const w = arena({ minePulseLevel: 1, mineBroodLevel: 1, mineFragments: 4 }), p = getPlayer(w), e = enemy(w, 200)
    tryPlaceMine(w, p); w.mines[0]!.fuseTicks = 1; updateMines(w)
    expect(e.hp).toBeCloseTo(1000 - 30 / 1.45); expect(w.mines).toHaveLength(1); expect(w.mines[0]!.exploding).toBe(true); expect(w.projectiles).toHaveLength(0)
    for (let i = 0; i < ARSENAL_RULES.pulseGap; i++) updateMines(w)
    expect(e.hp).toBeCloseTo(1000 - 60 / 1.45); expect(w.projectiles).toHaveLength(4); expect(w.mines).toHaveLength(2)
    expect(w.mines.every((m) => m.child && m.broodLevel === 0 && m.pulsesRemaining === 2)).toBe(true)
    expect(w.mines[0]!.damage).toBeCloseTo(30 / 1.45 * broodProfile(1).inherit)
  })
  it('separates parent/child limits, replaces oldest children and prevents recursive offspring', () => {
    const w = arena({ mineLimit: 1, mineBroodLevel: 1 }), p = getPlayer(w)
    for (let i = 0; i < 3; i++) { p.mineCooldownTicks = 0; tryPlaceMine(w, p); const mother = w.mines.find((m) => !m.child)!; mother.fuseTicks = 1; updateMines(w); expect(w.mines.filter((m) => m.child).length).toBeLessThanOrEqual(3) }
    expect(w.mines).toHaveLength(3); p.mineCooldownTicks = 0; tryPlaceMine(w, p); expect(w.mines.filter((m) => m.child)).toHaveLength(3); expect(w.mines.filter((m) => !m.child)).toHaveLength(1)
    for (const m of w.mines) { m.fuseTicks = 1; if (!m.child) m.broodLevel = 0 }
    updateMines(w); expect(w.mines).toHaveLength(0)
  })
  it('expires children without detonation or offspring after their lifetime', () => {
    const w = arena({ mineBroodLevel: 1 }); tryPlaceMine(w, getPlayer(w)); w.mines[0]!.fuseTicks = 1; updateMines(w)
    w.tick = broodProfile(1).lifetime; updateMines(w); expect(w.mines).toHaveLength(0)
  })
  it('immediately enforces reduced parent and child caps after selling upgrades', () => {
    const w = arena(), p = getPlayer(w)
    buyCard(w, 'mine-stock'); buyCard(w, 'mine-brood')
    for (let i = 0; i < 5; i++) { p.mineCooldownTicks = 0; tryPlaceMine(w, p) }
    expect(w.mines.filter((m) => !m.child)).toHaveLength(5); sellCard(w, 'mine-stock'); expect(w.mines.filter((m) => !m.child)).toHaveLength(3)
    for (const mine of w.mines) mine.fuseTicks = 1; updateMines(w); expect(w.mines.filter((m) => m.child)).toHaveLength(6)
    sellCard(w, 'mine-brood'); expect(w.mines).toHaveLength(0)
  })
})
describe('arsenal persistence and network', () => {
  it('continues active laser, burn and mine stages deterministically after restore', () => {
    const w = arena(); for (const id of ['weapon-laser', 'mine-echo', 'mine-brood']) buyCard(w, id)
    const p = getPlayer(w), e = enemy(w, 250); p.laserTicks = 11; p.laserTimer = 4; damage(w, e.id, 20, 'heat')
    tryPlaceMine(w, p); w.mines[0]!.fuseTicks = 1; updateMines(w)
    const copy = restoreWorld(serializeWorld(w, true), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    expect(hashWorld(copy)).toBe(hashWorld(w))
    for (let i = 0; i < 40; i++) { for (const run of [w, copy]) step(run, new Map([[1, { move: { x: 0, y: 0 }, fire: false, aim: { x: 1, y: 0 } }]])); expect(hashWorld(copy)).toBe(hashWorld(w)) }
  })
  it('migrates real v3 schemas and loot-card levels without changing old paid history or raw pickups', () => {
    const w = arena({}, LEGACY_V3_REGISTRY); buyCard(w, 'miner'); buyCard(w, 'gourmet'); const p = getPlayer(w); p.hp = 31
    w.pickups.push({ id: w.nextEntityId++, kind: 'shard', pos: { x: 500, y: 500 }, value: 5, ttl: 600 })
    const world = serializeWorld(w); for (const attrs of [world.basePlayerAttrs, ...world.actors.map((a) => a.attrs)]) for (const key of Object.keys(ARSENAL_DEFAULTS)) delete (attrs as unknown as Record<string, number>)[key]
    const loaded = readCheckpoint(JSON.stringify({ format: 'prism-save', version: 1, balanceVersion: 3, name: '原构筑', savedAt: '2026-10-31T12:00:00Z', mode: 'dungeon', initialSeed: 90, restarts: 0, roomIndex: 0, world }))
    expect(loaded.balanceVersion).toBe(CURRENT_BALANCE_VERSION); expect(loaded.name).toBe('原构筑'); expect(loaded.world.actors[0]!.hp).toBe(31)
    expect(loaded.world.actors[0]!.attrs.mineShardChance).toBe(1); expect(loaded.world.actors[0]!.attrs.bloodOrbChance).toBe(1)
    expect(loaded.world.purchases).toEqual(w.purchases); expect(loaded.world.pickups[0]!.gainApplied).toBeUndefined(); expect(loaded.world.pickups[0]!.value).toBe(5)
    expect(readCheckpoint(JSON.stringify(loaded))).toEqual(loaded)
  })
  it('syncs energy traces, typed hits and neutral volatile traits for both seats', () => {
    const match = createDuelMatch(90, 'resource'); match.action(0, { kind: 'buy', id: 'weapon-laser' }); const w = match.world()
    createActor(w, { ...ENEMIES.bomber!, team: 'neutral', pos: { x: 1000, y: 300 } }); fireLaserPulse(w, w.actors.get(1)!, 0)
    const packet = decodePacket(encodePacket({ type: 'state', serial: 1, state: match.state(), world: serializeWorld(w, true) }))
    expect(packet.type).toBe('state'); expect(toSnapshot(w, 2).traces?.[0]?.team).toBe('enemy')
  })
})
