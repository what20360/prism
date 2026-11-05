import { describe, it, expect } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { LEGACY_V5_REGISTRY } from '../../src/content/legacyCardsV5'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { LEGACY_PLAYER_BASE_ATTRS } from '../../src/content/legacyPlayer'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createWorld, createActor, getPlayer, type World } from '../../src/core/world'
import { resolveAttrs } from '../../src/core/cards'
import { buyCard, sellCard } from '../../src/core/progress'
import { combatAttrs, isOutOfCombat } from '../../src/core/combat'
import { emitProjectile, updateWeapons } from '../../src/core/systems/weapons'
import { impactDamage, resolveHits } from '../../src/core/systems/hits'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { updateTimers } from '../../src/core/systems/timers'
import { updateMines } from '../../src/core/systems/mines'
import { applyDamage } from '../../src/core/systems/damage'
import { serializeWorld, restoreWorld } from '../../src/core/serialization'
import { readCheckpoint, CURRENT_BALANCE_VERSION } from '../../src/app/checkpoints'
import { validateTargets, validateFavorites } from '../../src/app/upgradePlans'
import { createCoopMatch, readCoopSave } from '../../src/app/modes/coop'
import { toSnapshot } from '../../src/core/snapshot'
import { WEAVER_RULES } from '../../src/core/weaverRules'
import { weaponPalette } from '../../src/render/canvas2d/weaponPalette'

function arena(registry = CARD_REGISTRY): World {
 const w = createWorld({ seed: 17, registry, economy: DEFAULT_ECONOMY, playerAttrs: registry === CARD_REGISTRY ? PLAYER_BASE_ATTRS : LEGACY_PLAYER_BASE_ATTRS,
  room: { id: 'test', kind: 'safe', bounds: { x: 0, y: 0, width: 100000, height: 100000 }, walls: [], spawns: [], pickups: [], entry: { x: 5000, y: 5000 } } })
 w.shards = 1e8; return w
}
const fire = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true }
function checkpoint(w: World) { return { format: 'prism-save', version: 1, balanceVersion: 5, savedAt: '2026-11-04T00:00:00Z', mode: 'dungeon', initialSeed: 17, restarts: 0, roomIndex: 0, world: serializeWorld(w, true) } }
function stripNewAttrs(w: ReturnType<typeof serializeWorld>) {
 const strip = (a: unknown) => { const attrs = a as Record<string, unknown>; delete attrs.damageScale; delete attrs.sniperPower }
 strip(w.basePlayerAttrs); for (const a of [...w.actors, ...w.pendingSpawns]) strip(a.attrs)
}

describe('sniper weapon and kinetic specialization', () => {
 it.each(['weapon-electric', 'weapon-laser'])('is single-purchase and mutually exclusive with %s in either purchase order', id => {
  const w = arena(); expect(buyCard(w, 'precision-stance').ok).toBe(true)
  expect(buyCard(w, 'precision-stance')).toEqual({ ok: false, reason: 'max-level' })
  expect(buyCard(w, id).ok).toBe(false); sellCard(w, 'precision-stance'); expect(buyCard(w, id).ok).toBe(true)
  expect(buyCard(w, 'precision-stance').ok).toBe(false)
 })
 it('converts impact velocity to base damage before every damage multiplier and resolves it on hit', () => {
  const w = arena(), p = getPlayer(w)
  for (const id of ['gun-damage', 'precision-stance', 'sniper-specialty', 'glass-cannon', 'burst', 'scatter']) expect(buyCard(w, id).ok).toBe(true)
  p.intent = fire; emitProjectile(w, p, 0, p.pos); const bullet = w.projectiles[0]!
  const scale = 2 * 2 * 1.4 * 1.1 * 1.1
  expect(p.attrs.damageScale).toBeCloseTo(scale)
  expect(impactDamage(bullet)).toBeCloseTo((12 + 2100 * 0.01) * scale)
  const enemy = createActor(w, { team: 'enemy', tier: 'normal', behavior: 'turret', attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1e6, armor: 0 }, pos: { ...p.pos }, contactDamage: 0, hasCore: false })
  resolveHits(w); expect(1e6 - enemy.hp).toBeCloseTo((12 + 21) * scale)
 })
 it('accelerating or deflecting a live shot changes its kinetic damage without losing its scalar bonuses', () => {
  const w = arena(), p = getPlayer(w); for (const id of ['precision-stance', 'sniper-specialty', 'homing']) buyCard(w, id)
  emitProjectile(w, p, 0); const b = w.projectiles[0]!, initial = impactDamage(b)
  b.vel = { x: b.vel.x * 2, y: b.vel.y }; expect(impactDamage(b) - initial).toBeCloseTo(1050 * 0.01 * 4)
 })
 it('cancels only specialization mobility penalties out of combat and keeps other movement upgrades', () => {
  const w = arena(), p = getPlayer(w); for (const id of ['precision-stance', 'sniper-specialty', 'sniper-specialty', 'thruster', 'heavy-stance']) buyCard(w, id)
  const base = PLAYER_BASE_ATTRS.speed * 0.85 + 25
  p.outOfCombatTicks = 179; expect(combatAttrs(p).speed).toBeCloseTo(base * 0.7 ** 2)
  p.outOfCombatTicks = 180; expect(isOutOfCombat(p)).toBe(true); expect(combatAttrs(p).speed).toBeCloseTo(base * 1.1)
  expect(toSnapshot(w).actors[0]!.stowed).toBe(true)
  p.intent = fire; expect(toSnapshot(w).actors[0]!.stowed).toBe(false); expect(combatAttrs(p).speed).toBeCloseTo(base * 0.7 ** 2)
  p.intent = { ...fire, fire: false }; p.laserTicks = 1; expect(isOutOfCombat(p)).toBe(false)
  p.laserTicks = 0; p.burstRemaining = 1; expect(isOutOfCombat(p)).toBe(false)
  p.burstRemaining = 0; sellCard(w, 'precision-stance'); expect(p.attrs.sniperPower).toBe(0); expect(p.attrs.speed).toBeCloseTo(base)
 })
})

describe('attack completion and path-based recovery', () => {
 it('starts a full basic cooldown on the final burst round rather than the first', () => {
  const w = arena(), p = getPlayer(w); buyCard(w, 'burst'); p.attrs.fireRate = 10; p.intent = fire
  updateWeapons(w); expect(p.fireCooldownTicks).toBe(0); expect(p.burstRemaining).toBe(1)
  for (let i = 0; i < 3; i++) updateWeapons(w)
  expect(w.projectiles).toHaveLength(1); updateWeapons(w); expect(w.projectiles).toHaveLength(2); expect(p.fireCooldownTicks).toBe(6)
  for (let i = 0; i < 5; i++) updateWeapons(w)
  expect(w.projectiles).toHaveLength(2); updateWeapons(w); expect(w.projectiles).toHaveLength(3)
 })
 it('cannot start a second laser cast until the entire previous duration and cooldown have elapsed', () => {
  const w = arena(), p = getPlayer(w); buyCard(w, 'weapon-laser'); buyCard(w, 'burst'); p.attrs.fireRate = 10; p.intent = fire
  updateWeapons(w); const duration = p.laserTicks! + 1
  expect(p.fireCooldownTicks).toBe(0)
  for (let i = 1; i < duration; i++) updateWeapons(w)
  expect(p.laserTicks).toBe(0); expect(p.fireCooldownTicks).toBe(6)
  for (let i = 0; i < 5; i++) updateWeapons(w)
  expect(p.laserTicks).toBe(0); updateWeapons(w); expect(p.laserTicks).toBe(duration - 1)
 })
 it('ends automatic sustained attacks with a full cooldown and weapon switching cannot erase it', () => {
  const w = arena(), p = getPlayer(w); buyCard(w, 'burst'); p.intent = fire; updateWeapons(w)
  p.intent = { ...fire, fire: false, automaticFire: true }; updateWeapons(w)
  expect(p.burstRemaining).toBe(0); expect(p.fireCooldownTicks).toBe(Math.round(60 / p.attrs.fireRate))
  p.fireCooldownTicks = 0; p.intent = fire; updateWeapons(w); expect(p.burstRemaining).toBe(1)
  buyCard(w, 'weapon-laser'); expect(p.burstRemaining).toBe(0); expect(p.fireCooldownTicks).toBeGreaterThan(0)
 })
 it.each([1, 4])('starts at half speed and recovers at half the original path even under a %s× mine slow', divisor => {
  const w = arena(), p = getPlayer(w); p.attrs = { ...p.attrs, range: 1000, homing: 1 }
  if (divisor > 1) w.mines.push({ id: 9000, ownerId: 9, team: 'enemy', pos: { ...p.pos }, hp: 1, damage: 0, bodyRadius: 1, triggerRadius: 1, blastRadius: 1, slowRadius: 10000, slowMultiplier: divisor, ignoreBullets: true, fuseTicks: null })
  emitProjectile(w, p, 0, p.pos); const b = w.projectiles[0]!
  expect(b.vel.x).toBe(350)
  let ticks = 0
  while (b.homingDistance! < 500 && ticks++ < 10000) {
   updateProjectiles(w, 1 / 60)
   if (b.homingDistance! < 500) expect(Math.hypot(b.vel.x, b.vel.y)).toBeCloseTo(350 + 350 * b.homingDistance! / 500)
  }
  expect(b.travelLeft).toBeLessThanOrEqual(500); expect(b.vel.x).toBeCloseTo(700)
  expect(b.homingRecoveryDistance).toBe(500)
 })
})

describe('nest shield disruption and energy display', () => {
 it('nest proximity uses the enlarged radius and explodes after .7 seconds, stripping shields for a minute', () => {
  const w = arena(), p = getPlayer(w); buyCard(w, 'shield'); p.shield = 30; p.hp = 50
  const q = createActor(w, { team: 'enemy', tier: 'boss', behavior: 'turret', attrs: PLAYER_BASE_ATTRS, contactDamage: 0, hasCore: false, pos: { x: 8000, y: 5000 } })
  w.mines.push({ id: 9000, ownerId: q.id, team: 'enemy', nestRole: 'worker', pos: { x: p.pos.x + 150, y: p.pos.y }, hp: 50, damage: 10, bodyRadius: 64, blastRadius: 190, triggerRadius: WEAVER_RULES.mineTrigger, slowRadius: 200, slowMultiplier: 2, fuseTicks: null, fuseTotalTicks: WEAVER_RULES.mineFuse })
  for (let i = 0; i < 41; i++) updateMines(w)
  expect(p.shield).toBe(30); expect(w.mines[0]!.fuseTicks).toBe(1)
  updateMines(w); expect(w.mines).toHaveLength(0); expect(p.shield).toBe(0); expect(p.hp).toBeLessThan(50); expect(p.shieldDisabledTicks).toBe(3600)
  expect(toSnapshot(w).actors[0]!.shieldDisabledSeconds).toBe(60)
  const restored = restoreWorld(serializeWorld(w, true), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
  expect(getPlayer(restored).shieldDisabledTicks).toBe(3600)
  sellCard(w, 'shield'); buyCard(w, 'shield'); buyCard(w, 'shield-regen'); expect(p.shield).toBe(0)
  for (let i = 0; i < 3599; i++) updateTimers(w)
  expect(p.shield).toBe(0); updateTimers(w); expect(p.shieldDisabledTicks).toBe(0); expect(p.shield).toBeGreaterThan(0)
 })
 it('only regenerates shields after stopping attacks and taking no damage for three seconds', () => {
  const w = arena(), p = getPlayer(w); buyCard(w, 'shield'); p.intent = fire
  for (let i = 0; i < 240; i++) updateTimers(w)
  expect(p.shield).toBe(0); p.intent = { ...fire, fire: false }
  for (let i = 0; i < 180; i++) updateTimers(w)
  expect(p.shield).toBe(0); updateTimers(w); expect(p.shield).toBeGreaterThan(0)
  applyDamage(w, { targetId: p.id, sourceId: 99, sourceTeam: 'enemy', raw: 1, penetration: 0, isCore: false }); const shield = p.shield
  updateTimers(w); expect(p.shield).toBe(shield)
  expect(CARD_REGISTRY.get('shield-steal')).toBeUndefined()
 })
 it('makes exhausted projectiles paler and more transparent, while preserving team hues', () => {
  const full = weaponPalette('player', 'physical', 1, 10), low = weaponPalette('player', 'physical', 0.01, 10)
  expect(full.alpha).toBeGreaterThan(low.alpha); expect(low.color).toContain('93.77%'); expect(full.color).toContain('71%')
  expect(weaponPalette('enemy', 'physical', 1, 10).hue).not.toBe(full.hue)
 })
})

describe('balance v6 save and preset migration', () => {
 it('splits repeated old sniper levels, preserves actual payments and completed plan milestones, refunds deleted cards', () => {
  const w = arena(LEGACY_V5_REGISTRY); for (const id of ['precision-stance', 'precision-stance', 'precision-stance', 'shield', 'shield-steal']) buyCard(w, id)
  const old = checkpoint(w); stripNewAttrs(old.world)
  const paid = w.purchases.find(p => p.id === 'precision-stance')!.paid!, removed = w.purchases.find(p => p.id === 'shield-steal')!.paid![0]!
  const data = { ...old, plan: { enabled: true, targets: [{ id: 'precision-stance', level: 2 }, { id: 'gun-damage', level: 1 }, { id: 'precision-stance', level: 4 }, { id: 'shield-steal', level: 2 }] } }
  const loaded = readCheckpoint(JSON.stringify(data))
  expect(loaded.balanceVersion).toBe(CURRENT_BALANCE_VERSION)
  expect(loaded.world.purchases.find(p => p.id === 'precision-stance')).toEqual({ id: 'precision-stance', level: 1, paid: paid.slice(0, 1) })
  expect(loaded.world.purchases.find(p => p.id === 'sniper-specialty')).toEqual({ id: 'sniper-specialty', level: 2, paid: paid.slice(1) })
  expect(loaded.world.shards).toBe(w.shards + Math.floor(removed * 0.6))
  expect(loaded.plan!.targets).toEqual([{ id: 'gun-damage', level: 1 }, { id: 'sniper-specialty', level: 3 }])
  expect(readCheckpoint(JSON.stringify(loaded))).toEqual(loaded)
 })
 it('retains old energy weapons and refunds incompatible old sniper purchases instead of changing weapon', () => {
  const w = arena(LEGACY_V5_REGISTRY); buyCard(w, 'weapon-laser'); buyCard(w, 'precision-stance'); buyCard(w, 'precision-stance')
  const paid = w.purchases.find(p => p.id === 'precision-stance')!.paid!, loaded = readCheckpoint(JSON.stringify({ ...checkpoint(w), plan: { enabled: true, targets: [{ id: 'precision-stance', level: 3 }, { id: 'gun-damage', level: 1 }] } }))
  expect(loaded.plan!.targets).toEqual([{ id: 'gun-damage', level: 1 }])
  expect(loaded.world.actors[0]!.attrs.weapon).toBe(2); expect(loaded.world.actors[0]!.attrs.maxProjectiles).toBe(0)
  expect(loaded.world.purchases.map(p => p.id)).toEqual(['weapon-laser']); expect(loaded.world.shards).toBe(w.shards + paid.reduce((s, p) => s + Math.floor(p * 0.6), 0))
 })
 it('normalizes imported presets without losing their ordered repeated sniper milestones', () => {
  expect(validateTargets([{ id: 'precision-stance', level: 1 }, { id: 'gun-damage', level: 1 }, { id: 'precision-stance', level: 2 }, { id: 'precision-stance', level: 3 }, { id: 'shield-steal', level: 1 }])).toEqual([
   { id: 'precision-stance', level: 1 }, { id: 'gun-damage', level: 1 }, { id: 'sniper-specialty', level: 1 }, { id: 'sniper-specialty', level: 2 },
  ])
  expect(validateFavorites(['shield-steal', 'precision-stance', 'gun-damage'])).toEqual(['precision-stance', 'gun-damage'])
 })
 it('migrates each cooperative participant independently, including offline members at the final boss', () => {
  const m = createCoopMatch(), id = m.join('队友'), w = { ...m.world(), registry: LEGACY_V5_REGISTRY, basePlayerAttrs: { ...LEGACY_PLAYER_BASE_ATTRS } }
  for (const actorId of [1, id]) w.actors.get(actorId)!.attrs = { ...LEGACY_PLAYER_BASE_ATTRS }
  for (const actorId of [1, id]) { w.participants![actorId]!.shards = 10000; buyCard(w, 'precision-stance', actorId); buyCard(w, 'precision-stance', actorId) }
  const saved = m.save(); saved.roomIndex = 25
  const raw = { ...saved, world: serializeWorld(w, true), balanceVersion: 5 }; stripNewAttrs(raw.world)
  const loaded = readCoopSave(JSON.stringify(raw))
  expect(loaded.balanceVersion).toBe(CURRENT_BALANCE_VERSION)
  for (const actorId of [1, id]) expect(loaded.world.participants![actorId]!.purchases.find(p => p.id === 'sniper-specialty')!.level).toBe(1)
  expect(readCoopSave(JSON.stringify(loaded))).toEqual(loaded)
  expect(resolveAttrs(PLAYER_BASE_ATTRS, loaded.world.participants![id]!.purchases, CARD_REGISTRY)).toEqual(loaded.world.actors.find(a => a.id === id)!.attrs)
 })
})
