import { describe, it, expect } from 'vitest'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createActor, createWorld, getPlayer, type World } from '../../src/core/world'
import { fireElectric } from '../../src/core/systems/energyWeapons'
import type { AttrSet } from '../../src/core/attrs'
function arena(attrs: Partial<AttrSet> = {}) {
  return createWorld({ seed: 52, economy: DEFAULT_ECONOMY, registry: CARD_REGISTRY, playerAttrs: { ...PLAYER_BASE_ATTRS, range: 500, damage: 10, ...attrs },
    room: { id: 'trees', kind: 'combat', bounds: { x: 0, y: 0, width: 3000, height: 2000 }, walls: [], spawns: [], pickups: [], entry: { x: 100, y: 500 } } })
}
function enemy(w: World, x: number, y = 500) { return createActor(w, { team: 'enemy', behavior: 'turret', tier: 'normal', contactDamage: 0, hasCore: false, pos: { x, y }, attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1e6 } }) }
describe('acyclic electric trees', () => {
  it('uses exactly 80% of final range on each later edge', () => {
    for (const gap of [400, 400.01]) {
      const w = arena({ pierce: 2, burstCount: 2 }), root = enemy(w, 450), next = enemy(w, 450 + gap)
      getPlayer(w).lockTargetId = root.id; fireElectric(w, getPlayer(w), 0)
      expect(root.hp).toBeLessThan(root.attrs.maxHp); expect(next.hp < next.attrs.maxHp).toBe(gap === 400)
    }
  })
  it('forks from one root, charging each child once with identical attenuation', () => {
    const w = arena({ pierce: 3, burstCount: 2 }), root = enemy(w, 450), a = enemy(w, 650, 600), b = enemy(w, 650, 400)
    getPlayer(w).lockTargetId = root.id; fireElectric(w, getPlayer(w), 0)
    expect(w.traces!.map((t) => t.from)).toEqual([getPlayer(w).pos, root.pos, root.pos])
    expect(w.traces!.map((t) => t.power)).toEqual([10, 6.2, 6.2])
    expect(a.hp).toBe(b.hp)
  })
  it('attenuates by depth rather than sibling order or total previously hit targets', () => {
    const w = arena({ pierce: 4, burstCount: 3 }), root = enemy(w, 450), first = enemy(w, 800), sibling = enemy(w, 450, 700), deep = enemy(w, 1150)
    getPlayer(w).lockTargetId = root.id; fireElectric(w, getPlayer(w), 0)
    const power = (x: number, y: number) => w.traces!.find((t) => t.to.x === x && t.to.y === y)!.power
    expect(power(first.pos.x, first.pos.y)).toBeCloseTo(6.2); expect(power(sibling.pos.x, sibling.pos.y)).toBeCloseTo(6.2)
    expect(power(deep.pos.x, deep.pos.y)).toBeCloseTo(3.844)
  })
  it('uses burst for maximum depth and pierce for total tree size', () => {
    for (const [burstCount, pierce, hits] of [[1, 5, 1], [2, 3, 3], [2, 5, 5]] as const) {
      const w = arena({ pierce, burstCount }), root = enemy(w, 450)
      for (let i = 0; i < 5; i++) enemy(w, 600 + i * 10, 400 + i * 40)
      getPlayer(w).lockTargetId = root.id; fireElectric(w, getPlayer(w), 0); expect(w.traces).toHaveLength(hits)
    }
  })
  it('cannot cycle inside one tree while independent scatter trees may share all targets', () => {
    const w = arena({ multishot: 2, burstCount: 8, pierce: 8 }); enemy(w, 400); enemy(w, 450, 580); enemy(w, 450, 420)
    fireElectric(w, getPlayer(w), 0); expect(w.traces).toHaveLength(6)
    for (let i = 0; i < 2; i++) expect(new Set(w.traces!.slice(i * 3, i * 3 + 3).map((t) => `${t.to.x}:${t.to.y}`)).size).toBe(3)
  })
  it('reinforces an entire depth uniformly and converts only the unused pierce to base damage', () => {
    const w = arena({ pierce: 6, burstCount: 3 }), root = enemy(w, 450); enemy(w, 650, 600); enemy(w, 650, 400)
    getPlayer(w).lockTargetId = root.id; fireElectric(w, getPlayer(w), 0)
    expect(w.traces!.map((t) => t.power)).toEqual([11.5, 9.775, 9.775])
  })
  it('does not bridge walls even when the other side is within the 80% radius', () => {
    const w = arena({ pierce: 8, burstCount: 3 }), root = enemy(w, 450), blocked = enemy(w, 700)
    w.room.walls = [{ x: 600, y: 0, width: 40, height: 1500 }]; getPlayer(w).lockTargetId = root.id
    fireElectric(w, getPlayer(w), 0); expect(blocked.hp).toBe(blocked.attrs.maxHp); expect(w.traces).toHaveLength(1)
  })
})
