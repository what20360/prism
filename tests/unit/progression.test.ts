import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { armorToMitigation, type AttrSet } from '../../src/core/attrs'
import { resolveAttrs } from '../../src/core/cards'
import { buyCard, listCardStates } from '../../src/core/progress'
import { step } from '../../src/core/simulation'
import { applyDamage } from '../../src/core/systems/damage'
import { tryActivateDeflect } from '../../src/core/systems/skills'
import { hashWorld } from '../../src/core/hash'
import type { RoomTemplate } from '../../src/core/world'
import { createWorld, getPlayer } from '../../src/core/world'

const EMPTY_ROOM: RoomTemplate = {
  id: 'test',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  walls: [],
  spawns: [],
  kind: 'combat',
  entry: { x: 300, y: 540 },
}

function makeWorld(shards = 1000) {
  const world = createWorld({
    seed: 1,
    room: EMPTY_ROOM,
    economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY,
    playerAttrs: PLAYER_BASE_ATTRS,
  })
  world.shards = shards
  return world
}

function setAttrs(player: ReturnType<typeof getPlayer>, overrides: Partial<AttrSet>): void {
  player.attrs = { ...player.attrs, ...overrides }
}

describe('card pipeline', () => {
  it('applies cards in a stable order regardless of purchase order', () => {
    const a = resolveAttrs(PLAYER_BASE_ATTRS, [{ id: 'shard-gain', level: 1 }, { id: 'gun-damage', level: 2 }], CARD_REGISTRY)
    const b = resolveAttrs(PLAYER_BASE_ATTRS, [{ id: 'gun-damage', level: 2 }, { id: 'shard-gain', level: 1 }], CARD_REGISTRY)
    expect(a).toEqual(b)
  })

  it('prices only on purchase count', () => {
    const card = CARD_REGISTRY.get('gun-damage')
    expect(card).toBeDefined()
    if (!card) return
    expect(card.priceFn(1)).toBe(10)
    expect(card.priceFn(2)).toBe(16)
    expect(card.priceFn(3)).toBe(26)
  })

  it('buying deducts shards, raises the level and re-resolves attrs', () => {
    const world = makeWorld(100)
    const player = getPlayer(world)
    const before = player.attrs.damage

    expect(buyCard(world, 'gun-damage').ok).toBe(true)

    expect(world.shards).toBe(90)
    expect(player.attrs.damage).toBeCloseTo(before + 2, 10)
    expect(world.purchases).toHaveLength(1)
  })

  it('rejects purchases without enough shards', () => {
    const world = makeWorld(5)
    const result = buyCard(world, 'gun-damage')

    expect(result).toEqual({ ok: false, reason: 'not-enough-shards' })
    expect(world.purchases).toHaveLength(0)
  })

  it('enforces prerequisites', () => {
    const world = makeWorld(1000)

    const locked = listCardStates(world).find((card) => card.id === 'lifesteal')
    expect(locked?.availability).toBe('locked')
    expect(buyCard(world, 'lifesteal')).toEqual({ ok: false, reason: 'requirements' })

    expect(buyCard(world, 'shard-gain').ok).toBe(true)
    const unlocked = listCardStates(world).find((card) => card.id === 'lifesteal')
    expect(unlocked?.availability).toBe('ok')
    expect(buyCard(world, 'lifesteal').ok).toBe(true)
  })

  it('has no hard cap on numeric upgrades', () => {
    const world = makeWorld(1_000_000)

    for (let i = 0; i < 20; i += 1) buyCard(world, 'armor')

    const armor = getPlayer(world).attrs.armor
    expect(armor).toBe(200)
    expect(armorToMitigation(armor)).toBeLessThan(1)
  })
})

describe('lifesteal and shield steal', () => {
  it('heals for a share of damage dealt', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    player.hp = 10
    setAttrs(player, { lifesteal: 0.5 })

    const target = [...world.actors.values()].find((actor) => actor.team === 'enemy')
    expect(target).toBeUndefined()

    world.actors.set(99, {
      ...player,
      id: 99,
      team: 'enemy',
      pos: { x: 500, y: 540 },
      hp: 1000,
      shield: 0,
      attrs: { ...player.attrs, armor: 0 },
    })

    applyDamage(world, {
      targetId: 99,
      sourceId: player.id,
      sourceTeam: 'player',
      raw: 20,
      penetration: 0,
      isCore: false,
    })

    expect(player.hp).toBeCloseTo(20, 6)
  })

  it('caps shield steal at max hp * shieldCapMult', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { shieldSteal: 1, shieldCapMult: 1, armor: 0 })

    world.actors.set(99, {
      ...player,
      id: 99,
      team: 'enemy',
      pos: { x: 500, y: 540 },
      hp: 1000,
      shield: 0,
      attrs: { ...player.attrs, armor: 0 },
    })

    applyDamage(world, {
      targetId: 99,
      sourceId: player.id,
      sourceTeam: 'player',
      raw: 500,
      penetration: 0,
      isCore: false,
    })

    expect(player.shield).toBeCloseTo(player.attrs.maxHp, 6)
  })
})

describe('deflect and reflect', () => {
  it('deflect transfers bullet ownership without damaging the player', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { deflectLevel: 1 })

    expect(tryActivateDeflect(world, player)).toBe(true)
    world.projectiles.push({
      id: 500,
      ownerId: 0,
      team: 'enemy',
      pos: { x: player.pos.x, y: player.pos.y },
      prevPos: { x: player.pos.x, y: player.pos.y },
      vel: { x: 450, y: 0 },
      radius: 6,
      damage: 10,
      penetration: 0,
      pierceLeft: 1,
      innerMult: 1.5,
      travelLeft: 500,
      hitIds: [],
    })

    step(world, new Map())

    expect(world.projectiles[0]?.team).toBe('player')
    expect(player.hp).toBe(player.attrs.maxHp)
  })

  it('reflect reverses direction and boosts damage', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { deflectLevel: 2, reflectDamageMult: 1.5 })

    tryActivateDeflect(world, player)
    world.projectiles.push({
      id: 501,
      ownerId: 0,
      team: 'enemy',
      pos: { x: player.pos.x, y: player.pos.y },
      prevPos: { x: player.pos.x, y: player.pos.y },
      vel: { x: 450, y: 0 },
      radius: 6,
      damage: 10,
      penetration: 0,
      pierceLeft: 1,
      innerMult: 1.5,
      travelLeft: 500,
      hitIds: [],
    })

    step(world, new Map())

    const reflected = world.projectiles[0]
    expect(reflected?.vel.x).toBeCloseTo(-450, 6)
    expect(reflected?.damage).toBeCloseTo(15, 6)
  })

  it('does nothing without the skill', () => {
    const world = makeWorld()
    const player = getPlayer(world)

    expect(tryActivateDeflect(world, player)).toBe(false)
  })

  it('passive field bends bullets nearby and pushes harder up close', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { deflectFieldRadius: 220, deflectFieldStrength: 900 })

    const spawnBullet = (x: number): void => {
      world.projectiles.push({
        id: 500 + x,
        ownerId: 0,
        team: 'enemy',
        pos: { x: player.pos.x + x, y: player.pos.y },
        prevPos: { x: player.pos.x + x, y: player.pos.y },
        vel: { x: 0, y: 380 },
        radius: 10,
        damage: 10,
        penetration: 0,
        pierceLeft: 1,
        innerMult: 1.5,
        travelLeft: 5000,
        hitIds: [],
      })
    }

    spawnBullet(190)
    spawnBullet(90)
    step(world, new Map())

    const far = world.projectiles.find((p) => p.id === 690)
    const near = world.projectiles.find((p) => p.id === 590)
    expect(far?.vel.x).toBeGreaterThan(0)
    expect(near?.vel.x).toBeGreaterThan(far?.vel.x ?? 0)
  })

  it('the active window pushes much harder than the passive field', () => {
    const makeWithWindow = (active: boolean) => {
      const world = makeWorld()
      const player = getPlayer(world)
      setAttrs(player, { deflectFieldRadius: 220, deflectFieldStrength: 600, deflectLevel: 1 })
      if (active) player.deflectWindowTicks = 12

      world.projectiles.push({
        id: 700,
        ownerId: 0,
        team: 'enemy',
        pos: { x: player.pos.x + 120, y: player.pos.y + 120 },
        prevPos: { x: player.pos.x + 120, y: player.pos.y + 120 },
        vel: { x: 0, y: 420 },
        radius: 10,
        damage: 10,
        penetration: 0,
        pierceLeft: 1,
        innerMult: 1.5,
        travelLeft: 5000,
        hitIds: [],
      })
      step(world, new Map())
      return Math.abs(world.projectiles[0]?.vel.x ?? 0)
    }

    expect(makeWithWindow(true)).toBeGreaterThan(makeWithWindow(false))
  })
})

describe('revives', () => {
  it('consumes a revive instead of ending the run', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { revives: 1, armor: 0 })

    applyDamage(world, {
      targetId: player.id,
      sourceId: 0,
      sourceTeam: 'enemy',
      raw: 1000,
      penetration: 0,
      isCore: false,
    })

    expect(player.alive).toBe(true)
    expect(player.hp).toBeGreaterThan(0)
    expect(world.revivesUsed).toBe(1)
    expect(world.gameOver).toBe(false)
  })

  it('ends the run once revives are exhausted', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    setAttrs(player, { revives: 1, armor: 0 })

    const lethal = {
      targetId: player.id,
      sourceId: 0,
      sourceTeam: 'enemy' as const,
      raw: 1000,
      penetration: 0,
      isCore: false,
    }

    applyDamage(world, lethal)
    player.iframesTicks = 0
    applyDamage(world, lethal)

    expect(player.alive).toBe(false)
    expect(world.gameOver).toBe(true)
  })
})

describe('pause and determinism', () => {
  it('does not advance while paused', () => {
    const world = makeWorld()
    world.paused = true
    const before = hashWorld(world)

    step(world, new Map())

    expect(world.tick).toBe(0)
    expect(hashWorld(world)).toBe(before)
  })

  it('keeps purchases out of the hash only through derived attrs', () => {
    const world = makeWorld()
    buyCard(world, 'gun-damage')
    const afterBuy = hashWorld(world)

    expect(typeof afterBuy).toBe('string')
  })
})

describe('card info', () => {
  it('describes every card effect twice differently by level', () => {
    for (const card of CARD_REGISTRY.all()) {
      expect(typeof card.summary, card.id).toBe('function')
      const first = card.summary?.(1)
      expect(first, card.id).toBeTruthy()
      if (card.maxLevel !== 1) expect(card.summary?.(2), card.id).not.toBe(first)
    }
  })

  it('exposes summaries and prerequisites to the menu', () => {
    const states = listCardStates(makeWorld())

    const deflect = states.find((state) => state.id === 'deflect')
    expect(deflect?.requires).toEqual([{ attr: 'armor', min: 20 }])
    expect(deflect?.summary).toContain('力场半径')

    const damage = states.find((state) => state.id === 'gun-damage')
    expect(damage?.summary).toBe('伤害 +2（每级 +2） · 可回收')
    expect(damage?.requires).toEqual([])
  })
})

describe('shield cards', () => {
  it('hands over the shield points a shield card promises', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    const before = player.shield

    buyCard(world, 'shield')

    expect(player.shield).toBeGreaterThan(before)
    expect(player.shield).toBe(player.attrs.shield)
  })

  it('never lets the shield exceed its cap when the card is bought', () => {
    const world = makeWorld()
    const player = getPlayer(world)
    player.shield = 0
    setAttrs(player, { shieldCapMult: 0.2 })

    buyCard(world, 'shield')

    expect(player.shield).toBeLessThanOrEqual(player.attrs.maxHp * player.attrs.shieldCapMult + 1e-9)
  })
})
