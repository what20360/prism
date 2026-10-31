import { describe, expect, it } from 'vitest'
import { DEFAULT_FAVORITES, orderPreset, moveTarget, removeTarget, readPreset, validateTargets } from '../../src/app/upgradePlans'
import { createPurchaseQueue, PURCHASE_NOTICE_TICKS } from '../../src/app/purchaseQueue'
import { createWorld } from '../../src/core/world'
import { buyCard, listCardStates } from '../../src/core/progress'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
const ordered = [{ id: 'gun-damage', level: 1 }, { id: 'gun-range', level: 1 }, { id: 'gun-firerate', level: 1 }, { id: 'gun-damage', level: 2 }]
describe('portable ordered builds', () => {
  it('round-trips repeated purchase steps, favorites and uncapped goals without sorting', () => {
    const preset = { format: 'prism-build', version: 2, name: '自定义流派', targets: [...ordered, { id: 'suspension', level: 50 }], favorites: DEFAULT_FAVORITES, quickMode: 'planned' }
    expect(readPreset(JSON.stringify(preset))).toEqual(preset); expect(orderPreset(ordered)).toEqual(ordered)
    expect(() => readPreset('{"format":"prism-save","version":1}')).toThrow()
  })
  it('migrates the old five-slot format into favorites', () => {
    const result = readPreset(JSON.stringify({ format: 'prism-build', version: 1, name: '旧流派', targets: ordered.slice(0, 2), quickSlots: ['gun-damage', null, 'gun-damage', null, 'homing'] }))
    expect(result.version).toBe(2); expect(result.favorites).toEqual(['gun-damage', 'homing']); expect(result.targets).toEqual(ordered.slice(0, 2))
  })
  it('rejects unknown cards, invalid levels, backwards repeated milestones and invalid favorites', () => {
    for (const targets of [[{ id: 'missing', level: 1 }], [{ id: 'ricochet', level: 2 }], [{ id: 'homing', level: -1 }], [{ id: 'gun-damage', level: 10000 }], [{ id: 'homing', level: 2 }, { id: 'homing', level: 1 }]]) expect(() => validateTargets(targets)).toThrow()
    expect(() => readPreset(JSON.stringify({ format: 'prism-build', version: 2, name: 'x', targets: [], favorites: ['unknown'], quickMode: 'planned' }))).toThrow()
  })
  it('keeps repeat levels consistent when moving or removing a purchase step', () => {
    expect(moveTarget(ordered, 3, -1)).toEqual([ordered[0], ordered[1], ordered[3], ordered[2]])
    expect(removeTarget(ordered, 0)).toEqual([ordered[1], ordered[2], { id: 'gun-damage', level: 1 }])
  })
})
function funded() {
  const world = createWorld({ seed: 1, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY, playerAttrs: PLAYER_BASE_ATTRS, room: { id: 'queue', kind: 'safe', bounds: { x: 0, y: 0, width: 2200, height: 1400 }, walls: [], entry: { x: 500, y: 500 }, spawns: [], pickups: [] } }); world.shards = 10000
  return world
}
describe('visible purchase delay', () => {
  it('waits a full three seconds for each offer and follows damage-range-speed-damage', () => {
    const world = funded(), queue = createPurchaseQueue(), plan = { enabled: true, targets: structuredClone(ordered) }, bought: string[] = []
    for (const expected of ordered) {
      const buy = (id: string) => { bought.push(id); return buyCard(world, id).ok }
      expect(queue.update(plan, listCardStates(world), 1, buy)?.id).toBe(expected.id)
      for (let i = 0; i < PURCHASE_NOTICE_TICKS - 1; i++) queue.update(plan, listCardStates(world), 1, buy)
      expect(bought).toHaveLength(ordered.indexOf(expected))
      queue.update(plan, listCardStates(world), 1, buy)
      expect(bought.at(-1)).toBe(expected.id)
    }
    expect(bought).toEqual(['gun-damage', 'gun-range', 'gun-firerate', 'gun-damage'])
  })
  it('shows manual offers without spending and disables offers in favorite mode', () => {
    const world = funded(), queue = createPurchaseQueue(), plan = { enabled: false, targets: structuredClone(ordered), quickMode: 'planned' as const }
    for (let i = 0; i < 600; i++) expect(queue.update(plan, listCardStates(world), 1, (id) => buyCard(world, id).ok)?.auto).toBe(false)
    expect(world.purchases).toEqual([])
    expect(queue.update({ ...plan, enabled: true, quickMode: 'favorites' }, listCardStates(world), 600, (id) => buyCard(world, id).ok)).toBeNull()
    expect(world.purchases).toEqual([])
  })
  it('resets the delay if funds disappear or prerequisites block the head', () => {
    const world = funded(), queue = createPurchaseQueue(), plan = { enabled: true, targets: structuredClone(ordered) }
    queue.update(plan, listCardStates(world), 1, (id) => buyCard(world, id).ok); queue.update(plan, listCardStates(world), 179, (id) => buyCard(world, id).ok)
    world.shards = 0; expect(queue.update(plan, listCardStates(world), 1, (id) => buyCard(world, id).ok)).toBeNull()
    world.shards = 1000; expect(queue.update(plan, listCardStates(world), 1, (id) => buyCard(world, id).ok)?.remainingTicks).toBe(180)
    expect(queue.update({ enabled: true, targets: [{ id: 'ricochet', level: 1 }, { id: 'gun-pierce', level: 1 }] }, listCardStates(world), 600, (id) => buyCard(world, id).ok)).toBeNull()
    expect(world.purchases).toEqual([])
  })
})
