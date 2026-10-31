import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import type { AttrSet } from '../../src/core/attrs'
import { createActor, createWorld, getPlayer, type World, type Actor } from '../../src/core/world'
import { fireElectric, fireLaserPulse } from '../../src/core/systems/energyWeapons'
import { updateTargetLocks } from '../../src/core/systems/targeting'
import { updateWeapons } from '../../src/core/systems/weapons'
import { buyCard, sellCard } from '../../src/core/progress'
import { hashWorld } from '../../src/core/hash'
import { serializeWorld, restoreWorld } from '../../src/core/serialization'
import { step } from '../../src/core/simulation'

function arena(attrs: Partial<AttrSet> = {}) {
  const world = createWorld({ seed: 91, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY, playerAttrs: { ...PLAYER_BASE_ATTRS, ...attrs },
    room: { id: 'variants', kind: 'combat', bounds: { x: 0, y: 0, width: 3000, height: 2000 }, walls: [], spawns: [], pickups: [], entry: { x: 800, y: 800 } } })
  world.shards = 1e9; getPlayer(world).intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false }; return world
}
function target(w: World, x: number, y = 800, team: Actor['team'] = 'enemy') {
  return createActor(w, { team, tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false, pos: { x, y },
    attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1e6, armor: 0, speed: 0, fireRate: 0 } })
}
describe('all-direction electric acquisition and independent conduction', () => {
  it('uses aim and explicit lock as priorities while spending extra scatter behind the player', () => {
    for (const pinned of [false, true]) {
      const w = arena({ range: 800, multishot: 3 }), p = getPlayer(w), ahead = target(w, 1000), back = target(w, 600), side = target(w, 800, 1050)
      p.lockTargetId = pinned ? back.id : null
      fireElectric(w, p, 0)
      expect(w.traces).toHaveLength(3); expect(w.traces![0]!.to).toEqual((pinned ? back : ahead).pos)
      expect([ahead, back, side].every((a) => a.hp < a.attrs.maxHp)).toBe(true)
    }
  })
  it.each([1, 2, 3])('grants each of three branches its own %i-pierce budget', (pierce) => {
    const w = arena({ range: 800, multishot: 3, burstCount: 3, pierce, damage: 10 }), p = getPlayer(w)
    const enemies = [target(w, 950), target(w, 800, 950), target(w, 650)]
    fireElectric(w, p, 0)
    expect(w.traces).toHaveLength(3 * pierce)
    // Each individual chain visits different enemies; different chains can hit one another's roots.
    for (let branch = 0; branch < 3; branch++) {
      const hits = w.traces!.slice(branch * pierce, (branch + 1) * pierce).map((t) => `${t.to.x},${t.to.y}`)
      expect(new Set(hits).size).toBe(pierce)
    }
    if (pierce === 3) expect(enemies.every((a) => a.attrs.maxHp - a.hp > 10)).toBe(true)
  })
  it('conducts backwards and beyond the first acquisition radius without spending the first leg twice', () => {
    const w = arena({ range: 300, burstCount: 3, pierce: 3 }), p = getPlayer(w)
    const first = target(w, 1060), next = target(w, 1200), backwards = target(w, 1200, 1020)
    p.lockTargetId = first.id; fireElectric(w, p, 0)
    expect(w.traces!.map((t) => t.to)).toEqual([first.pos, next.pos, backwards.pos])
    expect([first, next, backwards].every((a) => a.hp < a.attrs.maxHp)).toBe(true)
  })
  it('rejects allies, unreachable first targets and out-of-hop targets', () => {
    const w = arena({ range: 300, multishot: 5, burstCount: 5, pierce: 5 }), p = getPlayer(w)
    const first = target(w, 1000), far = target(w, 1400), blocked = target(w, 800, 1000), ally = target(w, 700, 800, p.team)
    w.room.walls = [{ x: 650, y: 900, width: 450, height: 20 }]
    fireElectric(w, p, 0)
    expect(first.hp).toBeLessThan(first.attrs.maxHp)
    expect([far, blocked, ally].every((a) => a.hp === a.attrs.maxHp)).toBe(true)
  })
  it('lets actual purchases enable chaining with scatter rather than reserve away its next targets', () => {
    const w = arena(), p = getPlayer(w); target(w, 1000); target(w, 850, 1000)
    for (const id of ['weapon-electric', 'gun-pierce', 'burst', 'scatter']) expect(buyCard(w, id).ok).toBe(true)
    fireElectric(w, p, 0); expect(w.traces).toHaveLength(4)
  })
})
describe('aim preference and laser focusing', () => {
  it('auto aim shoots behind a stationary mouse, and switching back restores manual aim immediately', () => {
    const w = arena(), p = getPlayer(w), back = target(w, 600)
    p.intent = { ...p.intent, autoAim: true, fire: true }; updateTargetLocks(w); updateWeapons(w)
    expect(p.lockTargetId).toBe(back.id); expect(w.projectiles[0]!.vel.x).toBeLessThan(0)
    p.intent = { ...p.intent, autoAim: false }; p.fireCooldownTicks = 0; updateTargetLocks(w); updateWeapons(w)
    expect(p.lockTargetId).toBeNull(); expect(w.projectiles.at(-1)!.vel.x).toBeGreaterThan(0)
  })
  it('keeps auto aim on a valid target despite mouse movement, honors a pinned target and rejects wall cover', () => {
    const w = arena(), p = getPlayer(w), back = target(w, 600), pinned = target(w, 800, 600)
    p.intent = { ...p.intent, autoAim: true, fire: true, lockTarget: pinned.id }; updateTargetLocks(w); updateWeapons(w)
    expect(p.lockTargetId).toBe(pinned.id); expect(w.projectiles[0]!.vel.y).toBeLessThan(0)
    pinned.alive = false; p.intent = { ...p.intent, lockTarget: undefined, aim: { x: 1, y: 0 } }; updateTargetLocks(w)
    expect(p.lockTargetId).toBe(back.id)
    w.room.walls = [{ x: 700, y: 700, width: 10, height: 200 }]; updateTargetLocks(w); expect(p.lockTargetId).toBeNull()
  })
  it('does not follow mouse motion in automatic mode when no targets are visible', () => {
    const w = arena(), p = getPlayer(w); p.aimAngle = Math.PI / 2; p.intent = { ...p.intent, autoAim: true, fire: true }
    updateTargetLocks(w); updateWeapons(w); expect(p.aimAngle).toBe(Math.PI / 2); expect(w.projectiles[0]!.vel.y).toBeGreaterThan(0)
  })
  it.each([1, 3, 20])('narrows laser scatter at focus level %i while retaining three rays and increasing damage', (level) => {
    const baseline = arena({ range: 600, multishot: 3, damage: 10 }), focused = arena({ range: 600, multishot: 3, damage: 10, laserPower: level })
    for (const w of [baseline, focused]) fireLaserPulse(w, getPlayer(w), 0)
    const spread = (w: World) => Math.abs(Math.atan2(w.traces![0]!.to.y - 800, w.traces![0]!.to.x - 800))
    expect(focused.traces).toHaveLength(3); expect(spread(focused)).toBeCloseTo(spread(baseline) / (1 + 0.2 * level))
    expect(focused.traces![0]!.power).toBeGreaterThan(baseline.traces![0]!.power)
    expect(focused.traces![1]!.to.y).toBe(800)
  })
  it.each([0, 1, 2])('replays weapon %i with scatter, burst and penetration identically across save/restore', (weapon) => {
    const w = arena({ weapon, range: 1000, multishot: 3, burstCount: 3, pierce: 6, laserPower: 2, arcEfficiency: 2, homing: weapon === 0 ? 2 : 0, bulletSpeed: 400 })
    target(w, 1100); target(w, 950, 950); target(w, 650)
    const restored = restoreWorld(serializeWorld(w, true), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    const intents = new Map([[1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true, autoAim: true }]])
    for (let i = 0; i < 180; i++) { step(w, intents); step(restored, intents); expect(hashWorld(w)).toBe(hashWorld(restored)) }
    expect(w.stats.damageDealt).toBeGreaterThan(0)
  })
  it('separates weapon-specific cards and removes focus effects on sale', () => {
    const w = arena(), p = getPlayer(w)
    expect(CARD_REGISTRY.all().filter((c) => c.category === 'weapon').map((c) => c.id)).toEqual(['weapon-electric', 'weapon-laser', 'arc-coil', 'laser-focus'])
    buyCard(w, 'weapon-laser'); buyCard(w, 'laser-focus'); expect(p.attrs.laserPower).toBe(1)
    sellCard(w, 'laser-focus'); expect(p.attrs.laserPower).toBe(0)
    expect(CARD_REGISTRY.get('laser-focus')!.summary!(3)).toContain('散射角间距')
  })
})
