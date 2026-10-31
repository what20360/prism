import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { createCardRegistry } from '../../src/core/cards'
import { buyCard, sellCard, saleValue, listCardStates } from '../../src/core/progress'
import { resolveHits } from '../../src/core/systems/hits'
import { tryPlaceMine } from '../../src/core/systems/mines'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { createActor, createWorld, getPlayer, type Projectile } from '../../src/core/world'

function world() {
  const value = createWorld({ seed: 7, playerAttrs: PLAYER_BASE_ATTRS, economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY, room: { id: 'test', kind: 'combat', entry: { x: 100, y: 100 },
      bounds: { x: 0, y: 0, width: 1000, height: 800 }, walls: [], spawns: [] } })
  value.shards = 10000
  return value
}

describe('builds and card recycling', () => {
  it('starts without automatic abilities, and independently unlocks each card', () => {
    const w = world(), p = getPlayer(w)
    expect(p.attrs.autoAim).toBe(0); expect(p.attrs.autoFire).toBe(0)
    buyCard(w, 'auto-aim')
    expect(p.attrs.autoAim).toBe(1); expect(p.attrs.autoFire).toBe(0)
    buyCard(w, 'auto-fire')
    expect(p.attrs.autoFire).toBe(1)
    expect(sellCard(w, 'auto-aim')).toBe(true)
    expect(p.attrs.autoAim).toBe(0); expect(p.attrs.autoFire).toBe(1)
  })

  it('refunds 60% of the actual purchase and never creates a buy/sell profit', () => {
    const w = world(), start = w.shards
    buyCard(w, 'auto-fire')
    expect(saleValue(w, 'auto-fire')).toBe(7)
    sellCard(w, 'auto-fire')
    expect(w.shards).toBe(start - 5)
    expect(sellCard(w, 'auto-fire')).toBe(false)
    buyCard(w, 'gun-damage')
    expect(sellCard(w, 'gun-damage')).toBe(true)
  })

  it('keeps original paid prices even if the pricing function changes', () => {
    let cost = 20
    const registry = createCardRegistry([{ id: 'mode', name: 'mode', category: 'special', priority: 1,
      resellable: true, priceFn: () => cost, effectFn: (_level, attrs) => attrs }])
    const w = createWorld({ seed: 1, registry, playerAttrs: PLAYER_BASE_ATTRS, economy: DEFAULT_ECONOMY,
      room: { id: 'r', kind: 'safe', entry: { x: 100, y: 100 }, bounds: { x: 0, y: 0, width: 800, height: 600 }, walls: [], spawns: [] } })
    w.shards = 100
    buyCard(w, 'mode'); cost = 1000
    expect(saleValue(w, 'mode')).toBe(12)
  })

  it('sells a prerequisite without removing previously purchased dependents', () => {
    const base = CARD_REGISTRY.get('auto-aim')!
    const dependent = { ...base, id: 'dependent', requires: [{ card: 'auto-aim', level: 1 }] }
    const w = createWorld({ seed: 1, registry: createCardRegistry([base, dependent]), playerAttrs: PLAYER_BASE_ATTRS,
      economy: DEFAULT_ECONOMY, room: { id: 'r', kind: 'safe', entry: { x: 100, y: 100 }, bounds: { x: 0, y: 0, width: 800, height: 600 }, walls: [], spawns: [] } })
    w.shards = 100
    buyCard(w, 'auto-aim'); buyCard(w, 'dependent')
    expect(sellCard(w, 'auto-aim')).toBe(true)
    expect(listCardStates(w).find((card) => card.id === 'auto-aim')!.saleBlocked).toBeNull()
    expect(w.purchases.some((purchase) => purchase.id === 'dependent')).toBe(true)
  })

  it('reverses a sold stance and clamps health after a maximum health tradeoff', () => {
    const w = world(), p = getPlayer(w)
    buyCard(w, 'heavy-stance')
    expect(p.attrs.damage).toBeCloseTo(13.5)
    sellCard(w, 'heavy-stance')
    expect(p.attrs.damage).toBe(10)
    buyCard(w, 'glass-cannon')
    expect(p.hp).toBeLessThanOrEqual(p.attrs.maxHp)
  })

  it('applies mine build stats to newly placed mines', () => {
    const w = world(), p = getPlayer(w)
    buyCard(w, 'mine-power'); buyCard(w, 'mine-radius'); buyCard(w, 'mine-cooldown'); buyCard(w, 'mine-slow')
    tryPlaceMine(w, p)
    expect(w.mines[0]).toMatchObject({ damage: 38, blastRadius: 225, triggerRadius: 135 })
    expect(w.mines[0]?.slowMultiplier).toBeCloseTo(2.5)
    expect(p.mineCooldownTicks).toBeLessThan(120)
  })

  it('makes higher level deflection fields strictly stronger', () => {
    const w = world(), p = getPlayer(w)
    buyCard(w, 'armor'); buyCard(w, 'armor'); buyCard(w, 'deflect')
    const radius = p.attrs.deflectFieldRadius
    buyCard(w, 'deflect')
    expect(p.attrs.deflectFieldRadius).toBe(radius + 40)
    expect(p.attrs.deflectFieldStrength).toBe(820)
  })
})

function bullet(): Projectile {
  return { id: 99, ownerId: 1, team: 'player', pos: { x: 980, y: 400 }, prevPos: { x: 980, y: 400 },
    vel: { x: 500, y: 0 }, radius: 8, damage: 10, penetration: 0, pierceLeft: 2, innerMult: 1.5,
    travelLeft: 2000, hitIds: [], ricochet: true, blastRadius: 0 }
}

describe('projectile build mechanics', () => {
  it('reflects from walls, consumes one pierce and still spends range', () => {
    const w = world(), b = bullet()
    w.projectiles = [b]
    updateProjectiles(w, 0.1)
    expect(w.projectiles).toHaveLength(1)
    expect(b.vel.x).toBeLessThan(0); expect(b.pierceLeft).toBe(1)
    expect(b.travelLeft).toBeLessThan(2000)
    b.pos = { x: 980, y: 400 }; b.vel = { x: 500, y: 0 }
    updateProjectiles(w, 0.1)
    expect(w.projectiles).toHaveLength(0)
  })

  it('splash damages nearby hostile targets once and never the shooter', () => {
    const w = world(), p = getPlayer(w)
    const spawn = (x: number) => createActor(w, { team: 'enemy', tier: 'normal', behavior: 'turret',
      hasCore: false, contactDamage: 0, attrs: { ...PLAYER_BASE_ATTRS, maxHp: 100 }, pos: { x, y: 300 } })
    const a = spawn(300), b = spawn(350), far = spawn(700)
    w.projectiles = [{ ...bullet(), pos: { x: 300, y: 300 }, prevPos: { x: 290, y: 300 }, blastRadius: 90 }]
    resolveHits(w)
    expect(a.hp).toBe(90); expect(b.hp).toBe(90); expect(far.hp).toBe(100)
    expect(p.hp).toBe(PLAYER_BASE_ATTRS.maxHp)
  })
})
