import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import type { AttrSet } from '../../src/core/attrs'
import { resolveAttrs } from '../../src/core/cards'
import { combatAttrs } from '../../src/core/combat'
import { hasLineOfSight } from '../../src/core/navigation'
import { hashWorld } from '../../src/core/hash'
import { circleIntersectsRect } from '../../src/core/collision'
import { applyRoom } from '../../src/core/dungeon'
import { buyCard, listCardStates } from '../../src/core/progress'
import { toSnapshot } from '../../src/core/snapshot'
import { updateAi } from '../../src/core/systems/ai'
import { updateDeflectFields } from '../../src/core/systems/deflectField'
import { applyDamage } from '../../src/core/systems/damage'
import { tryPlaceMine, updateMines, firstMineBodyHit } from '../../src/core/systems/mines'
import { updateMovement, separateActors } from '../../src/core/systems/movement'
import { updatePickups } from '../../src/core/systems/pickups'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { equipSkill, tryActivateSkill } from '../../src/core/systems/skills'
import { updateTargetLocks } from '../../src/core/systems/targeting'
import { updateTimers } from '../../src/core/systems/timers'
import { emitProjectile, updateWeapons } from '../../src/core/systems/weapons'
import { createActor, createWorld, getPlayer, type Projectile, type World } from '../../src/core/world'
function world(attrs: Partial<AttrSet> = {}) {
  const w = createWorld({ seed: 5, playerAttrs: { ...PLAYER_BASE_ATTRS, ...attrs }, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY,
    room: { id: 'r', kind: 'combat', entry: { x: 100, y: 400 }, bounds: { x: 0, y: 0, width: 1000, height: 800 }, walls: [], spawns: [] } })
  w.shards = 100000
  getPlayer(w).intent = { move: { x: 0, y: 0 }, fire: false, aim: { x: 1, y: 0 } }
  return w
}
function enemy(w: World, x: number, y: number, attrs: Partial<AttrSet> = {}) {
  return createActor(w, { team: 'enemy', behavior: 'chase', tier: 'normal', hasCore: false, contactDamage: 0,
    attrs: { ...PLAYER_BASE_ATTRS, fireRate: 0, speed: 150, radius: 20, maxHp: 100, ...attrs }, pos: { x, y } })
}
function bullet(overrides: Partial<Projectile> = {}): Projectile {
  return { id: 900, ownerId: 1, team: 'player', pos: { x: 100, y: 400 }, prevPos: { x: 100, y: 400 }, vel: { x: 700, y: 0 },
    damage: 10, penetration: 0, pierceLeft: 1, innerMult: 1.5, travelLeft: 2000, radius: 8, hitIds: [], ...overrides }
}
describe('shared target locks', () => {
  it('selects along the attack direction rather than the nearest enemy behind', () => {
    const w = world(), p = getPlayer(w), ahead = enemy(w, 500, 410)
    enemy(w, 70, 400); enemy(w, 250, 200)
    updateTargetLocks(w); expect(p.lockTargetId).toBe(ahead.id)
  })
  it('keeps a manual lock until it dies, then returns to directional selection', () => {
    const w = world(), p = getPlayer(w), forward = enemy(w, 500, 400), pinned = enemy(w, 70, 400)
    p.intent = { ...p.intent, lockTarget: pinned.id }; updateTargetLocks(w)
    p.intent = { ...p.intent, lockTarget: undefined }; updateTargetLocks(w); expect(p.lockTargetId).toBe(pinned.id)
    pinned.alive = false; updateTargetLocks(w); expect(p.lockTargetId).toBe(forward.id); expect(p.manualLockId).toBeNull()
  })
  it('does not direction-lock through walls and accepts an explicit cancellation', () => {
    const w = world(), p = getPlayer(w), target = enemy(w, 500, 400)
    w.room.walls = [{ x: 300, y: 200, width: 30, height: 400 }]
    updateTargetLocks(w); expect(p.lockTargetId).toBeNull()
    p.intent = { ...p.intent, lockTarget: target.id }; updateTargetLocks(w); expect(p.lockTargetId).toBe(target.id)
    p.intent = { ...p.intent, lockTarget: null }; updateTargetLocks(w); expect(p.lockTargetId).toBeNull()
  })
  it('auto aim uses the same pinned target and exposes its basic data', () => {
    const w = world(), p = getPlayer(w), target = enemy(w, 100, 150, { armor: 35, damage: 8 })
    p.intent = { ...p.intent, fire: true, autoAim: true, lockTarget: target.id }
    updateTargetLocks(w); updateWeapons(w)
    expect(w.projectiles[0]!.vel.y).toBeLessThan(0)
    expect(toSnapshot(w).actors.find((a) => a.id === target.id)).toMatchObject({ locked: true, manualLocked: true, armor: 35, damage: 8, hp: 100 })
  })
  it('homing upgrades shorten both the resolved range and newly emitted projectile travel', () => {
    const w = world(), p = getPlayer(w)
    buyCard(w, 'homing'); expect(p.attrs.range).toBeCloseTo(560 / 1.2)
    emitProjectile(w, p, 0); expect(w.projectiles[0]!.travelLeft).toBeCloseTo(560 / 1.2)
    buyCard(w, 'homing'); expect(p.attrs.range).toBeCloseTo(560 / 1.4)
  })
  it('homing launches slowly, turns toward the lock and accelerates', () => {
    const w = world({ homing: 1 }), p = getPlayer(w), target = enemy(w, 500, 650)
    p.lockTargetId = target.id; emitProjectile(w, p, 0)
    const shot = w.projectiles[0]!; expect(shot.vel.x).toBe(420)
    updateProjectiles(w, 0.2)
    expect(shot.vel.y).toBeGreaterThan(0); expect(Math.hypot(shot.vel.x, shot.vel.y)).toBeGreaterThan(420)
    target.alive = false; p.lockTargetId = null; updateProjectiles(w, 0.1)
    expect(Number.isFinite(shot.pos.x)).toBe(true)
  })
})
describe('projectile combinations and continuous collision', () => {
  it('multiplies burst rounds and shotgun pellets while holding the burst direction', () => {
    const w = world(), p = getPlayer(w); buyCard(w, 'burst'); buyCard(w, 'scatter')
    p.intent = { ...p.intent, fire: true }; updateWeapons(w)
    p.intent = { ...p.intent, fire: false, aim: { x: 0, y: -1 } }
    for (let i = 0; i < 8; i++) updateWeapons(w)
    expect(w.projectiles).toHaveLength(6)
    expect(w.projectiles.every((b) => b.vel.x > 0)).toBe(true)
    expect(new Set(w.projectiles.map((b) => b.vel.y)).size).toBe(3)
  })
  it('sniper changes only range/speed and enforces a single bullet for combinations and fragments', () => {
    const w = world(), p = getPlayer(w)
    for (const id of ['burst', 'scatter', 'shrapnel', 'precision-stance']) buyCard(w, id)
    expect(p.attrs.maxHp).toBe(50); expect(p.attrs.speed).toBe(330)
    p.intent = { ...p.intent, fire: true }; updateWeapons(w)
    expect(w.projectiles).toHaveLength(1)
    tryPlaceMine(w, p); w.mines[0]!.fuseTicks = 1; updateMines(w)
    expect(w.projectiles).toHaveLength(1)
    w.projectiles = []; tryPlaceMine(w, p); p.burstTimer = 0; updateWeapons(w)
    expect(w.projectiles).toHaveLength(1)
  })
  it('buying sniper removes surplus already-flying player bullets', () => {
    const w = world(), p = getPlayer(w)
    for (let i = 0; i < 3; i++) emitProjectile(w, p, i)
    buyCard(w, 'precision-stance'); expect(w.projectiles).toHaveLength(1)
  })
  it('spends penetration in flight order on enemies and wall bounces', () => {
    const w = world(), target = enemy(w, 950, 400, { radius: 8 })
    const shot = bullet({ pos: { x: 900, y: 400 }, vel: { x: 1000, y: 0 }, pierceLeft: 3, ricochet: true })
    w.projectiles = [shot]; updateProjectiles(w, 0.15)
    expect(target.hp).toBe(90); expect(shot.pierceLeft).toBe(1); expect(shot.vel.x).toBeLessThan(0)
  })
  it('high-speed shots hit targets swept along the path', () => {
    const w = world(), a = enemy(w, 350, 400), b = enemy(w, 650, 400)
    w.projectiles = [bullet({ vel: { x: 50000, y: 0 }, pierceLeft: 2 })]; updateProjectiles(w, 1 / 60)
    expect(a.hp).toBe(90); expect(b.hp).toBe(90)
  })
  it('high-speed shots cannot pass a wall to damage a target behind it', () => {
    const w = world(), target = enemy(w, 600, 400)
    w.room.walls = [{ x: 300, y: 200, width: 10, height: 400 }]
    w.projectiles = [bullet({ vel: { x: 50000, y: 0 } })]; updateProjectiles(w, 1 / 60)
    expect(target.hp).toBe(100); expect(w.projectiles).toHaveLength(0)
  })
})
describe('mine divisor, upgrades and drops', () => {
  it('divides bullet movement by the strongest overlapping multiplier without altering intrinsic speed', () => {
    const w = world(), p = getPlayer(w); tryPlaceMine(w, p)
    const shot = bullet({ team: 'enemy', ownerId: 99, pos: { x: 100, y: 450 }, prevPos: { x: 100, y: 450 } })
    w.projectiles = [shot]; updateProjectiles(w, 0.1)
    expect(shot.pos.x).toBeCloseTo(135); expect(shot.vel.x).toBe(700)
    w.mines.push({ ...w.mines[0]!, id: 99, slowMultiplier: 4 }); shot.pos = { x: 100, y: 450 }
    updateProjectiles(w, 0.1); expect(shot.pos.x).toBeCloseTo(117.5)
  })
  it('grows the three mine radii independently and upgrades cooldown speed', () => {
    const w = world(), p = getPlayer(w)
    for (const id of ['mine-radius', 'mine-detection', 'mine-field', 'mine-cooldown']) buyCard(w, id)
    tryPlaceMine(w, p)
    expect(w.mines[0]).toMatchObject({ blastRadius: 225, triggerRadius: 140, slowRadius: 140 })
    expect(p.mineCooldownTicks).toBe(100)
  })
  it('ignore prevents bullet triggering and body hits while weakening the divisor', () => {
    const w = world(), p = getPlayer(w); buyCard(w, 'mine-ignore'); tryPlaceMine(w, p)
    const shot = bullet({ team: 'enemy', pos: { ...p.pos } }); w.projectiles = [shot]
    expect(firstMineBodyHit(w, shot)).toBeUndefined(); updateMines(w)
    expect(w.mines[0]!.fuseTicks).toBeNull(); expect(w.mines[0]!.slowMultiplier).toBeCloseTo(1.45)
  })
  it('grenades keep their release direction and explode after travelling', () => {
    const w = world(), p = getPlayer(w); buyCard(w, 'grenade')
    p.intent = { ...p.intent, move: { x: 1, y: 0 } }; tryPlaceMine(w, p)
    p.intent = { ...p.intent, move: { x: -1, y: 0 } }; updateMines(w)
    expect(w.mines[0]!.pos.x).toBeGreaterThan(100)
    for (let i = 0; i < 180; i++) updateMines(w)
    expect(w.mines).toHaveLength(0); expect(w.effects.some((e) => e.kind === 'explosion')).toBe(true)
  })
  it('sluggish requires grenade and increases health and visible fuse duration', () => {
    const w = world(), p = getPlayer(w)
    expect(buyCard(w, 'sluggish').ok).toBe(false); buyCard(w, 'grenade'); buyCard(w, 'sluggish'); tryPlaceMine(w, p)
    enemy(w, 150, 400); updateMines(w)
    expect(w.mines[0]!.hp).toBe(4); expect(w.mines[0]!.fuseTicks).toBeGreaterThan(30)
    expect(toSnapshot(w).mines[0]!.fuseTotal).toBeGreaterThan(0.5)
  })
  it('shrapnel emits player-strength bullets and inherits projectile mechanics', () => {
    const w = world({ homing: 1, ricochet: 1 }), p = getPlayer(w); buyCard(w, 'shrapnel'); buyCard(w, 'gun-damage')
    tryPlaceMine(w, p); w.mines[0]!.fuseTicks = 1; updateMines(w)
    expect(w.projectiles).toHaveLength(4)
    expect(w.projectiles.every((b) => b.damage === 12 && b.ricochet && b.homingTurn! > 0)).toBe(true)
  })
  it('only effective bullet/mine damage creates the corresponding pickup, which heals/pays on contact', () => {
    const w = world({ bloodOrbChance: 1, mineShardChance: 1 }), p = getPlayer(w), target = enemy(w, 140, 400)
    p.hp = 10
    for (const kind of ['bullet', 'mine'] as const) applyDamage(w, { targetId: target.id, sourceId: p.id, sourceTeam: 'player', raw: 10, penetration: 0, isCore: false, kind })
    expect(w.pickups.map((d) => d.kind)).toEqual(['blood', 'shard'])
    const shards = w.shards; updatePickups(w)
    expect(p.hp).toBe(14); expect(w.shards).toBe(shards + 2); expect(w.pickups).toHaveLength(0)
    target.iframesTicks = 20
    applyDamage(w, { targetId: target.id, sourceId: p.id, sourceTeam: 'player', raw: 10, penetration: 0, isCore: false, kind: 'bullet' })
    expect(w.pickups).toHaveLength(0)
  })
})
describe('two active skill slots and final priorities', () => {
  it('owns three skills but only equips two, preserving cooldowns and ending unequipped effects', () => {
    const w = world(), p = getPlayer(w)
    for (const id of ['armor', 'armor', 'deflect', 'rage', 'dash']) buyCard(w, id)
    expect(p.skillSlots).toEqual(['deflect', 'rage'])
    equipSkill(p, 0, 'dash'); expect(tryActivateSkill(w, p, 0)).toBe(true)
    const cd = p.dashCooldownTicks; equipSkill(p, 0, 'deflect'); expect(p.dashTicks).toBe(0)
    equipSkill(p, 0, 'dash'); expect(p.dashCooldownTicks).toBe(cd); expect(tryActivateSkill(w, p, 0)).toBe(false)
    expect(equipSkill(p, 2, 'rage')).toBe(false)
  })
  it('rage buffs all promised combat stats and expires without changing permanent attributes', () => {
    const w = world({ rageLevel: 1 }), p = getPlayer(w), original = { ...p.attrs }
    expect(tryActivateSkill(w, p, 0)).toBe(true)
    expect(combatAttrs(p)).toMatchObject({ damage: 15, mineDamage: 45, armor: 30, lifesteal: 0.1 })
    expect(combatAttrs(p).fireRate).toBeCloseTo(1.05)
    for (let i = 0; i < 300; i++) updateTimers(w)
    expect(p.attrs).toEqual(original); expect(combatAttrs(p)).toEqual(original)
  })
  it('active deflection reclaims bullets at the field edge while obeying the sniper cap', () => {
    const w = world({ deflectLevel: 2, deflectFieldRadius: 220, deflectFieldStrength: 600, maxProjectiles: 1 }), p = getPlayer(w)
    p.deflectWindowTicks = 10
    w.projectiles = [bullet({ id: 90, team: 'enemy', ownerId: 99, pos: { x: 230, y: 430 } }), bullet({ id: 91, team: 'enemy', ownerId: 99, pos: { x: 240, y: 450 } })]
    updateDeflectFields(w, 1 / 60)
    expect(w.projectiles).toHaveLength(1); expect(w.projectiles[0]!.ownerId).toBe(p.id)
    expect(w.projectiles[0]!.vel.x).toBeLessThan(0); expect(w.projectiles[0]!.damage).toBe(15)
  })
  it('applies final percentage life costs independently of purchase order and displays numeric priority', () => {
    const purchases = [{ id: 'maxhp', level: 2 }, { id: 'coward', level: 1 }, { id: 'glass-cannon', level: 1 }]
    const first = resolveAttrs(PLAYER_BASE_ATTRS, purchases, CARD_REGISTRY)
    const second = resolveAttrs(PLAYER_BASE_ATTRS, [...purchases].reverse(), CARD_REGISTRY)
    expect(first).toEqual(second); expect(first.maxHp).toBeCloseTo(70 * 0.8 * 0.7)
    expect(listCardStates(world()).find((c) => c.id === 'coward')!.priority).toBe(1000)
  })
  it('resets locks, queued bursts and drops on room transitions', () => {
    const w = world(), p = getPlayer(w); p.manualLockId = 20; p.lockTargetId = 20; p.burstRemaining = 4
    w.pickups.push({ id: 90, kind: 'blood', pos: p.pos, value: 4, ttl: 30 })
    applyRoom(w, { id: 'n', kind: 'combat', entry: { x: 100, y: 400 }, bounds: w.room.bounds, walls: [], spawns: [] })
    expect(p.lockTargetId).toBeNull(); expect(p.burstRemaining).toBe(0); expect(w.pickups).toHaveLength(0)
  })
})
describe('navigation and simulation coverage', () => {
  it('routes a pursuing enemy around a wall without entering geometry', () => {
    const w = world(), p = getPlayer(w), chaser = enemy(w, 900, 400)
    w.room.walls = [{ x: 450, y: 200, width: 100, height: 400 }]
    for (let i = 0; i < 600; i++) { updateAi(w); updateMovement(w); separateActors(w); expect(circleIntersectsRect(chaser.pos.x, chaser.pos.y, chaser.radius, w.room.walls[0]!)).toBe(false) }
    expect(Math.hypot(chaser.pos.x - p.pos.x, chaser.pos.y - p.pos.y)).toBeLessThan(100)
  })
  it.each([[424.5, 174.5, 900], [424.5, 625.5, 900], [575.5, 174.5, 100], [575.5, 625.5, 100]])('escapes a legal rounded corner at (%s,%s) instead of treating it as trapped', (x, y, goalX) => {
    const w = world(), p = getPlayer(w), chaser = enemy(w, x!, y!, { radius: 34 })
    w.room.walls = [{ x: 450, y: 200, width: 100, height: 400 }]; p.pos = { x: goalX!, y: 400 }
    expect(circleIntersectsRect(chaser.pos.x, chaser.pos.y, chaser.radius, w.room.walls[0]!)).toBe(false)
    const away = { x: x! + (x! < 450 ? -40 : 40), y: y! }
    expect(hasLineOfSight(chaser.pos, away, w.room.walls, chaser.radius)).toBe(true)
    for (let i = 0; i < 900; i++) { updateAi(w); updateMovement(w); separateActors(w) }
    expect(Math.hypot(chaser.pos.x - p.pos.x, chaser.pos.y - p.pos.y)).toBeLessThan(90)
  })
  it.each([[416, 400, 900, 400], [584, 400, 100, 400], [500, 166, 500, 750], [500, 634, 500, 60], [440, 400, 900, 400]])('recovers from wall contact at (%s,%s) and continues pursuit', (x, y, goalX, goalY) => {
    const w = world(), p = getPlayer(w), chaser = enemy(w, x!, y!, { radius: 34 })
    w.room.walls = [{ x: 450, y: 200, width: 100, height: 400 }]; p.pos = { x: goalX!, y: goalY! }
    for (let i = 0; i < 900; i++) {
      updateAi(w); updateMovement(w); separateActors(w)
      expect(circleIntersectsRect(chaser.pos.x, chaser.pos.y, chaser.radius, w.room.walls[0]!)).toBe(false)
    }
    expect(Math.hypot(chaser.pos.x - p.pos.x, chaser.pos.y - p.pos.y)).toBeLessThan(90)
  })
  it('preserves analog movement and resolves coincident enemies deterministically', () => {
    const w = world(), p = getPlayer(w); p.intent = { ...p.intent, move: { x: 0.2, y: 0 } }; updateMovement(w)
    expect(p.pos.x).toBeCloseTo(101.1)
    const a = enemy(w, 700, 400), b = enemy(w, 700, 400)
    for (let i = 0; i < 20; i++) separateActors(w)
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(39)
  })
  it('hashes locks, cooldowns, projectiles and drops, excluding cosmetic trails', () => {
    const w = world(), p = getPlayer(w), baseline = hashWorld(w)
    p.lockTargetId = 20; expect(hashWorld(w)).not.toBe(baseline); p.lockTargetId = null
    emitProjectile(w, p, 0); const afterShot = hashWorld(w)
    w.projectiles[0]!.trail = [{ x: 9, y: 9 }]; expect(hashWorld(w)).toBe(afterShot)
    w.projectiles[0]!.damage += 1; expect(hashWorld(w)).not.toBe(afterShot)
  })
})
