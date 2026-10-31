import { describe, it, expect } from 'vitest'
import { silkDenRoom } from '../../src/content/levelSets'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createWorld, getPlayer, type World } from '../../src/core/world'
import { updateWeaver, updateNestSpider } from '../../src/core/systems/weaver'
import { updateAi } from '../../src/core/systems/ai'
import { updateTimers } from '../../src/core/systems/timers'
import { updateMovement, separateActors } from '../../src/core/systems/movement'
import { removeMine, updateMines } from '../../src/core/systems/mines'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { emitProjectile } from '../../src/core/systems/weapons'
import { applyDamage } from '../../src/core/systems/damage'
import { updateRoom } from '../../src/core/systems/room'
import { WEAVER_RULES as R } from '../../src/core/weaverRules'
import { restoreWorld, serializeWorld } from '../../src/core/serialization'
import { hashWorld } from '../../src/core/hash'
import { step } from '../../src/core/simulation'
import { toSnapshot } from '../../src/core/snapshot'

function setup() {
  const w = createWorld({ seed: 18, room: silkDenRoom(), economy: DEFAULT_ECONOMY, registry: CARD_REGISTRY, playerAttrs: { ...PLAYER_BASE_ATTRS, maxHp: 1e6 } })
  const p = getPlayer(w), q = [...w.actors.values()].find((a) => a.behavior === 'weaver')!
  updateWeaver(w, q, p); return { w, p, q, s: q.weaver! }
}
const brood = (w: World, role = 'bomber') => [...w.actors.values()].filter((a) => a.alive && a.spider?.role === role)
describe('silk-den boss supplies and mines', () => {
  it('starts with two upper-corner mines, six roaming bombers and full independent caches', () => {
    const { w, s } = setup()
    expect(w.mines).toHaveLength(2); expect(w.mines.map((m) => m.nestRole)).toEqual(['worker', 'worker'])
    expect(brood(w)).toHaveLength(6); expect(s.mineStock).toBe(3); expect(s.spiderStock).toBe(6)
    expect(w.mines.map((m) => m.pos)).toEqual(w.room.design!.mineAnchors)
  })
  it('restores mine stock every six seconds and spider stock every four seconds without exceeding caps', () => {
    const { w, p, q, s } = setup(); s.mineStock = 0; s.spiderStock = 0
    for (let i = 0; i < R.spiderRegen - 1; i++) updateWeaver(w, q, p)
    expect(s.spiderStock).toBe(0); updateWeaver(w, q, p); expect(s.spiderStock).toBe(1)
    for (let i = R.spiderRegen; i < R.mineRegen - 1; i++) updateWeaver(w, q, p)
    expect(s.mineStock).toBe(0); updateWeaver(w, q, p); expect(s.mineStock).toBe(1)
    for (let i = 0; i < 2000; i++) updateWeaver(w, q, p)
    expect(s.mineStock).toBe(3); expect(s.spiderStock).toBe(6); expect(brood(w)).toHaveLength(6)
  })
  it('dispatches a worker only at three mine stock and gives it a nearby varied replacement site', () => {
    const { w, p, q, s } = setup(), old = w.mines[0]!
    removeMine(w, old); s.mineStock = 2; updateWeaver(w, q, p); expect(brood(w, 'worker')).toHaveLength(0)
    s.mineStock = 3; updateWeaver(w, q, p)
    const worker = brood(w, 'worker')[0]!; expect(s.mineStock).toBe(2); expect(s.lostMines).toHaveLength(0)
    expect(worker.spider!.task).toBe(true); expect(worker.spider!.goal).not.toEqual(old.pos)
    expect(Math.hypot(worker.spider!.goal.x - old.pos.x, worker.spider!.goal.y - old.pos.y)).toBeLessThan(110)
  })
  it('navigates the spiral to complete a worker delivery without getting stuck', () => {
    const { w, p, q } = setup(); removeMine(w, w.mines[0]!); updateWeaver(w, q, p)
    const worker = brood(w, 'worker')[0]!, delivery = { ...brood(w, 'worker')[0]!.spider!.goal }
    for (const a of [...w.actors.values()]) if (a.spider?.role === 'bomber') w.actors.delete(a.id)
    for (let i = 0; i < 1600 && worker.spider!.task; i++) {
      updateNestSpider(w, worker, p); updateMovement(w); separateActors(w); w.tick++
    }
    expect(worker.spider!.task, JSON.stringify({pos: worker.pos, goal: worker.spider!.goal, nav: worker.navPath, move: worker.intent.move})).toBe(false); expect(w.mines).toHaveLength(2)
    expect(w.mines.some((m) => Math.hypot(m.pos.x - delivery.x, m.pos.y - delivery.y) < 1)).toBe(true)
  })
  it('lays an intercepting 1.5-radius mine against a predicted incoming bullet above half health', () => {
    const { w, p, q, s } = setup(); p.pos = { x: q.pos.x - 210, y: q.pos.y }
    emitProjectile(w, p, 0, { x: q.pos.x - 200, y: q.pos.y }); updateWeaver(w, q, p)
    const mine = w.mines.find((m) => m.nestRole === 'queen')!
    expect(mine.bodyRadius).toBe(R.mineRadius * 1.5); expect(mine.blastRadius).toBe(R.mineBlast * 1.5); expect(mine.velocity).toBeUndefined(); expect(s.mineStock).toBe(2)
    updateProjectiles(w, 0.5); expect(q.hp).toBe(q.attrs.maxHp); expect(mine.hp).toBe(q.attrs.mineHp - p.attrs.damage)
  })
  it('stops defensive mine use below half health and sends offensive mines toward a visible player', () => {
    const { w, p, q } = setup(); q.hp = q.attrs.maxHp / 2; p.pos = { x: q.pos.x - 200, y: q.pos.y }
    updateWeaver(w, q, p)
    const mine = w.mines.find((m) => m.nestRole === 'queen')!
    expect(mine.velocity!.x).toBeLessThan(0); expect(mine.travelLeft).toBeGreaterThan(0)
    const other = setup(); other.q.hp /= 2
    emitProjectile(other.w, other.p, 0, { x: other.q.pos.x - 200, y: other.q.pos.y }); updateWeaver(other.w, other.q, other.p)
    expect(other.w.mines.some((m) => m.nestRole === 'queen')).toBe(false)
  })
  it('never exceeds six active mines including reserved worker deliveries', () => {
    const { w, p, q, s } = setup(); p.pos = { x: q.pos.x - 220, y: q.pos.y }; q.hp /= 2
    for (let i = 0; i < 12; i++) { s.mineStock = 3; q.mineCooldownTicks = 0; updateWeaver(w, q, p) }
    expect(w.mines).toHaveLength(6)
  })
})
describe('silk-den volleys and brood', () => {
  it('fires exactly three fans one second apart and starts the next cast ten seconds later', () => {
    const { w, p, q, s } = setup(); p.pos = { x: q.pos.x - 200, y: q.pos.y }; s.volleyCooldown = 0
    const shots: number[] = []; let count = 0
    for (let i = 0; i < 700; i++) {
      updateWeaver(w, q, p)
      const next = w.projectiles.filter((b) => b.ownerId === q.id).length
      if (next > count) { shots.push(i); expect(next - count).toBe(13); expect(q.intent.move).toEqual({ x: 0, y: 0 }); count = next }
    }
    expect(shots.slice(0, 3).map((n) => n - shots[0]!)).toEqual([0, 60, 120]); expect(shots[3]! - shots[0]!).toBe(600)
  })
  it('approaches before the second volley, retreats before the third and tracks the current player angle', () => {
    const { w, p, q, s } = setup(); p.pos = { x: q.pos.x - 200, y: q.pos.y }
    s.volley = 2; s.volleyTimer = 60; updateWeaver(w, q, p); expect(q.intent.move.x).toBeLessThan(0)
    s.volley = 3; s.volleyTimer = 60; updateWeaver(w, q, p); expect(q.intent.move.x).toBeGreaterThan(0)
    p.pos = { x: q.pos.x, y: q.pos.y - 200 }; s.volleyTimer = 1; updateWeaver(w, q, p)
    const middle = w.projectiles.filter((b) => b.ownerId === q.id)[6]!
    expect(Math.abs(middle.vel.x)).toBeLessThan(1e-6); expect(middle.vel.y).toBeLessThan(0)
  })
  it('stays within the innermost chamber even when baited outside or pushed by actors', () => {
    const { w, p, q, s } = setup(), area = w.room.design!.core!
    for (const a of [...w.actors.values()]) if (a.spider) w.actors.delete(a.id)
    s.spiderStock = 0; s.spiderRegen = 100000; p.pos = { x: 2800, y: 500 }
    for (let i = 0; i < 600; i++) {
      updateWeaver(w, q, p); updateMovement(w); separateActors(w)
      expect(q.pos.x).toBeGreaterThanOrEqual(area.x + q.radius); expect(q.pos.x).toBeLessThanOrEqual(area.x + area.width - q.radius)
      expect(q.pos.y).toBeGreaterThanOrEqual(area.y + q.radius); expect(q.pos.y).toBeLessThanOrEqual(area.y + area.height - q.radius)
    }
  })
  it('replaces dead spiders at two-second intervals, spending one stock each time', () => {
    const { w, p, q, s } = setup(); brood(w)[0]!.alive = false; s.spawnTimer = 0; s.spiderStock = 2
    updateWeaver(w, q, p); expect(brood(w)).toHaveLength(6); expect(s.spiderStock).toBe(1)
    brood(w)[0]!.alive = false
    for (let i = 0; i < R.summonGap - 1; i++) updateWeaver(w, q, p)
    expect(brood(w)).toHaveLength(5); updateWeaver(w, q, p); expect(brood(w)).toHaveLength(6); expect(s.spiderStock).toBe(0)
  })
  it('fills missing spiders once at half health without spending stock, paying maximum-health cost', () => {
    const { w, p, q, s } = setup(); brood(w).slice(0, 5).forEach((a) => { a.alive = false }); s.spiderStock = 0; q.hp = q.attrs.maxHp / 2
    updateWeaver(w, q, p); expect(brood(w)).toHaveLength(6); expect(s.spiderStock).toBe(0); expect(q.hp).toBeCloseTo(q.attrs.maxHp * (0.5 - 5 / 36))
    const hp = q.hp; updateWeaver(w, q, p); expect(q.hp).toBe(hp); expect(q.phase).toBe(2)
  })
  it('cannot self-clear through the low-health summoning payment', () => {
    const { w, p, q } = setup(); brood(w).forEach((a) => { a.alive = false }); q.hp = 1
    updateWeaver(w, q, p); expect(q.hp).toBe(1); expect(q.alive).toBe(true); expect(brood(w)).toHaveLength(6)
  })
  it('lets each pursuing bomber dash only once and telegraphs one self-explosion', () => {
    const { w, p, q } = setup(), spider = brood(w)[0]!
    p.pos = { x: q.pos.x - 200, y: q.pos.y }; spider.pos = { x: q.pos.x + 100, y: q.pos.y }
    updateNestSpider(w, spider, p); expect(spider.spider!.pursuing).toBe(true); expect(spider.spider!.dashUsed).toBe(true); expect(spider.dashTicks).toBe(24)
    for (let i = 0; i < 24; i++) updateTimers(w)
    spider.hp /= 3; updateNestSpider(w, spider, p); expect(spider.dashTicks).toBe(0)
    spider.pos = { x: p.pos.x + 80, y: p.pos.y }; const hp = p.hp
    for (let i = 0; i < R.spiderFuse; i++) updateNestSpider(w, spider, p)
    expect(spider.alive).toBe(false); expect(p.hp).toBeCloseTo(hp - spider.attrs.damage * R.spiderDamage)
    expect(w.projectiles.filter((b) => b.ownerId === spider.id)).toHaveLength(8); expect(w.stats.kills).toBe(0)
  })
  it('cleans up the nest on queen death and permits the final encounter to end', () => {
    const { w, p, q } = setup()
    applyDamage(w, { targetId: q.id, sourceId: p.id, sourceTeam: 'player', raw: 1e6, penetration: 1e6, isCore: false })
    updateAi(w); updateMines(w); updateRoom(w)
    expect(brood(w)).toHaveLength(0); expect(w.mines).toHaveLength(0); expect(w.victory).toBe(true)
  })
  it('serializes caches, jobs, phase and timers and resumes an identical deterministic fight', () => {
    const { w, p, q } = setup(); p.pos = { x: q.pos.x - 190, y: q.pos.y }; q.hp /= 2
    const intents = new Map([[p.id, { move: { x: 0, y: 0 }, fire: false }]])
    for (let i = 0; i < 90; i++) step(w, intents)
    const copy = restoreWorld(serializeWorld(w, true), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    expect(hashWorld(copy)).toBe(hashWorld(w)); expect(toSnapshot(copy).actors.find((a) => a.id === q.id)!.weaver).toBeDefined()
    for (let i = 0; i < 120; i++) { step(w, intents); step(copy, intents); expect(hashWorld(copy)).toBe(hashWorld(w)) }
    const invalid = serializeWorld(copy) as unknown as { actors: { weaver?: { mineStock: number } }[] }
    invalid.actors.find((a) => a.weaver)!.weaver!.mineStock = 4
    expect(() => restoreWorld(invalid, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))).toThrow()
  })
})
