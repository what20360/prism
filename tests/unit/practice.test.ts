import { describe, expect, it } from 'vitest'
import { createPracticeMode, DEFAULT_PRACTICE } from '../../src/app/modes/practice'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createWorld, getPlayer } from '../../src/core/world'
import { step } from '../../src/core/simulation'
import { applyDamage } from '../../src/core/systems/damage'
import { buyCard } from '../../src/core/progress'
import { emitProjectile } from '../../src/core/systems/weapons'
import { tryPlaceMine } from '../../src/core/systems/mines'
function setup(config = DEFAULT_PRACTICE) {
  const mode = createPracticeMode(config)
  const world = createWorld({ seed: 7, playerAttrs: PLAYER_BASE_ATTRS, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY, room: mode.room() })
  mode.initialize(world)
  const tick = () => { mode.beforeStep(world); step(world, new Map([[getPlayer(world).id, { move: { x: 0, y: 0 }, fire: false }]])); mode.afterStep(world) }
  return { mode, world, tick, player: getPlayer(world) }
}
describe('practice mode isolation and controls', () => {
  it('starts with live targets and no room transition or delayed entry', () => {
    const { world, mode } = setup()
    expect([...world.actors.values()].filter((a) => a.team === 'enemy')).toHaveLength(3)
    expect(world.room.phase).toBe('combat'); expect(world.pendingSpawns).toHaveLength(0)
    expect(mode.state(world).config).toEqual(DEFAULT_PRACTICE)
    expect(world.room.exit).toBeNull(); expect(world.shards).toBeGreaterThan(100000)
  })
  it('validates configuration ranges and creates real combat enemies with cover', () => {
    const { mode, world } = setup()
    mode.action(world, { type: 'configure', config: { ...DEFAULT_PRACTICE, scenario: 'combat', layout: 'cover', count: 99, hp: Infinity, armor: -10 } })
    expect(mode.state(world).config).toMatchObject({ count: 12, hp: 10000, armor: 0 })
    expect(world.room.walls.length).toBeGreaterThan(0)
    expect([...world.actors.values()].some((a) => a.team === 'enemy' && a.attrs.speed > 0)).toBe(true)
    const positions = new Set([...world.actors.values()].filter((a) => a.team === 'enemy').map((a) => `${a.pos.x}:${a.pos.y}`))
    expect(positions.size).toBe(12)
  })
  it('keeps normal card prices and paid records while credit is unlimited', () => {
    const { mode, world, player } = setup()
    buyCard(world, 'gun-damage'); mode.credit(world)
    expect(world.purchases[0]!.paid).toEqual([10]); expect(player.attrs.damage).toBe(12)
    mode.action(world, { type: 'configure', config: { ...DEFAULT_PRACTICE, freeCards: false } })
    expect(world.shards).toBe(1000)
    buyCard(world, 'gun-damage'); mode.credit(world)
    expect(world.shards).toBe(985)
  })
  it('allows explicit test level editing without leaking changes into base attributes', () => {
    const { mode, world, player } = setup()
    expect(mode.action(world, { type: 'card-level', id: 'deflect', level: 1 })).toBe(true)
    expect(player.attrs.deflectLevel).toBe(1); expect(player.attrs.armor).toBe(0)
    expect(player.skillSlots).toContain('deflect')
    expect(mode.action(world, { type: 'card-level', id: 'deflect', level: 0 })).toBe(true)
    expect(player.skillSlots).not.toContain('deflect'); expect(PLAYER_BASE_ATTRS.deflectLevel).toBe(0)
  })
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid test level %s without changing the build', (level) => {
    const { mode, world } = setup()
    expect(mode.action(world, { type: 'card-level', id: 'gun-damage', level })).toBe(false)
    expect(world.purchases).toHaveLength(0)
  })
  it('edits growth cards above level 20 without allocating a synthetic payment history', () => {
    const { mode, world, player } = setup()
    expect(mode.action(world, { type: 'card-level', id: 'gun-damage', level: 100 })).toBe(true)
    expect(player.attrs.damage).toBe(210)
    expect(world.purchases[0]).toMatchObject({ level: 100, paid: [] })
    expect(mode.action(world, { type: 'card-level', id: 'heavy-stance', level: 10000 })).toBe(false)
    expect(player.attrs.damage).toBe(210)
  })
  it('honours one-time card maxima and rejects unknown cards', () => {
    const { mode, world } = setup()
    expect(mode.action(world, { type: 'card-level', id: 'auto-aim', level: 2 })).toBe(false)
    expect(mode.action(world, { type: 'card-level', id: 'missing', level: 1 })).toBe(false)
  })
  it('rebuilds targets and clears transient entities while preserving cards and slots', () => {
    const { mode, world, player } = setup()
    mode.action(world, { type: 'card-level', id: 'rage', level: 1 }); buyCard(world, 'gun-damage')
    emitProjectile(world, player, 0); tryPlaceMine(world, player); player.rageTicks = 40; player.rageCooldownTicks = 200; player.hp = 1
    mode.action(world, { type: 'scene-reset' })
    expect(player.attrs.damage).toBe(12); expect(player.skillSlots).toContain('rage'); expect(player.hp).toBe(50)
    expect(player.rageTicks).toBe(0); expect(player.rageCooldownTicks).toBe(0)
    expect(world.projectiles).toHaveLength(0); expect(world.mines).toHaveLength(0); expect(mode.state(world).damage).toBe(0)
  })
  it('makes invulnerability optional and permits real death in a vulnerable test', () => {
    const { mode, world, player } = setup()
    const hit = { targetId: player.id, sourceId: 99, sourceTeam: 'enemy' as const, raw: 1000, penetration: 0, isCore: false }
    mode.beforeStep(world); applyDamage(world, hit); expect(player.hp).toBe(50)
    mode.action(world, { type: 'configure', config: { ...DEFAULT_PRACTICE, invincible: false } })
    mode.beforeStep(world); applyDamage(world, hit); mode.afterStep(world)
    expect(world.gameOver).toBe(true); expect(player.alive).toBe(false)
  })
  it('restores defeated dummies and keeps the room open for further measurements', () => {
    const { mode, world, player, tick } = setup({ ...DEFAULT_PRACTICE, hp: 10 })
    const target = [...world.actors.values()].find((a) => a.team === 'enemy')!
    applyDamage(world, { targetId: target.id, sourceId: player.id, sourceTeam: 'player', raw: 30, penetration: 0, isCore: false, kind: 'bullet' })
    tick()
    expect(target.alive).toBe(true); expect(target.hp).toBe(10); expect(world.room.exit).toBeNull()
    expect(mode.state(world).damage).toBe(10); expect(mode.state(world).recentDps).toBeCloseTo(10 / 3)
    expect(mode.state(world).kills).toBe(1)
    world.tick += 181; mode.afterStep(world); expect(mode.state(world).recentDps).toBe(0)
    mode.action(world, { type: 'meters-reset' }); expect(mode.state(world).damage).toBe(0); expect(mode.state(world).kills).toBe(0)
  })
})
