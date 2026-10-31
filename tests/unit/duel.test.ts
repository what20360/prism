import { createActor, allocateId } from '../../src/core/world'
import { ENEMIES } from '../../src/content/enemies'
import { updateAi } from '../../src/core/systems/ai'
import { resolveContactDamage } from '../../src/core/systems/damage'
import { updatePickups } from '../../src/core/systems/pickups'
import { separateActors } from '../../src/core/systems/movement'
import { describe, expect, it } from 'vitest'
import { createDuelMatch, DUEL_RULES, DUEL_ATTRS } from '../../src/app/modes/duel'
import { cleanIntent, createRemoteInput, decodePacket, encodePacket, IDLE_INPUT, DUEL_PROTOCOL } from '../../src/net/protocol'
import { serializeWorld } from '../../src/core/serialization'
import { toSnapshot } from '../../src/core/snapshot'
import { applyDamage } from '../../src/core/systems/damage'
import { decodeSignal } from '../../src/net/peer'
function fighting() { const match = createDuelMatch(111); match.ready(0); match.ready(1); for (let i = 0; i < DUEL_RULES.countdown; i++) match.tick(IDLE_INPUT, IDLE_INPUT); return match }
describe('authoritative 1v1', () => {
  it('requires both ready, counts down, gives equal gear and honors remote movement instead of AI', () => {
    const match = createDuelMatch(9); match.ready(0); match.tick(IDLE_INPUT, IDLE_INPUT); expect(match.state().phase).toBe('preparing')
    match.ready(1); expect(match.state().phase).toBe('countdown'); for (let i = 0; i < 180; i++) match.tick(IDLE_INPUT, IDLE_INPUT)
    const a = match.world().actors.get(1)!, b = match.world().actors.get(2)!, x = b.pos.x
    expect(a.attrs).toEqual(b.attrs); expect(a.attrs).toEqual(DUEL_ATTRS)
    match.tick(IDLE_INPUT, { ...IDLE_INPUT, move: { x: 1, y: 0 } })
    expect(b.pos.x).toBeGreaterThan(x); expect(match.world().projectiles).toHaveLength(0)
  })
  it('uses equal invulnerability for both players', () => {
    const match = fighting(), world = match.world()
    for (const [targetId, sourceId, sourceTeam] of [[1, 2, 'enemy'], [2, 1, 'player']] as const) {
      applyDamage(world, { targetId, sourceId, sourceTeam, raw: 10, penetration: 0, isCore: false })
      applyDamage(world, { targetId, sourceId, sourceTeam, raw: 10, penetration: 0, isCore: false })
      expect(world.actors.get(targetId)!.hp).toBe(90); expect(world.actors.get(targetId)!.iframesTicks).toBe(30)
    }
  })
  it('awards rounds, resets temporary entities, swaps sides and finishes at two wins', () => {
    const match = fighting(), originalX = match.world().actors.get(1)!.pos.x
    applyDamage(match.world(), { targetId: 2, sourceId: 1, sourceTeam: 'player', raw: 1000, penetration: 0, isCore: false }); match.tick(IDLE_INPUT, IDLE_INPUT)
    expect(match.state()).toMatchObject({ phase: 'round-over', wins: [1, 0], winner: 0 })
    match.ready(0); match.ready(1); expect(match.world().actors.get(1)!.pos.x).not.toBe(originalX); expect(match.world().projectiles).toHaveLength(0)
    for (let i = 0; i < 180; i++) match.tick(IDLE_INPUT, IDLE_INPUT)
    applyDamage(match.world(), { targetId: 2, sourceId: 1, sourceTeam: 'player', raw: 1000, penetration: 0, isCore: false }); match.tick(IDLE_INPUT, IDLE_INPUT)
    expect(match.state()).toMatchObject({ phase: 'finished', wins: [2, 0] })
    match.ready(0); match.ready(1); expect(match.state()).toMatchObject({ phase: 'countdown', wins: [0, 0], round: 1 })
  })
  it('adjudicates timeout ties and supports forfeiting without touching solo progression', () => {
    const match = fighting(); for (let i = 0; i < DUEL_RULES.roundTicks; i++) match.tick(IDLE_INPUT, IDLE_INPUT)
    expect(match.state()).toMatchObject({ phase: 'round-over', winner: 'draw', wins: [0, 0] })
    match.forfeit(0); expect(match.state()).toMatchObject({ phase: 'finished', winner: 1, wins: [0, 2] }); expect(match.world().purchases).toEqual([])
  })
  it('renders the guest as self with its own skill cooldowns and target lock', () => {
    const match = fighting(), world = match.world(); world.actors.get(2)!.lockTargetId = 1; world.actors.get(2)!.dashCooldownTicks = 30
    const view = toSnapshot(world, 2)
    expect(view.actors.find((a) => a.team === 'player')?.id).toBe(2); expect(view.actors.find((a) => a.id === 1)?.locked).toBe(true)
    expect(view.actors.find((a) => a.team === 'player')?.skills[1]?.cooldown).toBe(0.5)
  })
})
describe('duel protocol validation', () => {
  it('rejects stale sequences/rounds, expires held input and consumes one-shot skills only once', () => {
    const remote = createRemoteInput(), packet = { type: 'input' as const, sequence: 1, round: 1, intent: { ...IDLE_INPUT, fire: true, move: { x: 1, y: 0 }, skills: [0] } }
    expect(remote.accept(packet, 1, 100)).toBe(true)
    expect(remote.accept(packet, 1, 101)).toBe(false)
    expect(remote.accept({ ...packet, sequence: 2, round: 0 }, 1, 102)).toBe(false)
    expect(remote.read(110).skills).toEqual([0]); expect(remote.read(120).skills).toEqual([]); expect(remote.read(120).fire).toBe(true)
    expect(remote.read(401).fire).toBe(false); expect(remote.read(401).move).toEqual({ x: 0, y: 0 })
  })
  it('accepts state packets and strips attempts to author health, speed or positions through input', () => {
    const match = fighting(), packet = decodePacket(encodePacket({ type: 'state', serial: 1, state: match.state(), world: serializeWorld(match.world(), true) }))
    expect(packet.type).toBe('state')
    const intent = cleanIntent({ move: { x: 1, y: 1 }, aim: { x: 0, y: 1 }, fire: true, hp: 9999, attrs: { damage: 9999 }, skills: [0, 0, 1, 8] })
    expect(Math.hypot(intent.move.x, intent.move.y)).toBeCloseTo(1); expect(intent.skills).toEqual([0, 1]); expect(intent).not.toHaveProperty('hp')
    expect(() => cleanIntent({ move: { x: Infinity, y: 0 } })).toThrow()
    expect(() => decodePacket('{"protocol":9,"type":"ready"}')).toThrow()
  })
  it('rejects corrupt signaling and packets with altered standard equipment', () => {
    expect(() => decodeSignal('not-a-code', 'offer')).toThrow()
    const match = fighting(); match.world().actors.get(2)!.attrs.damage = 1000
    expect(() => decodePacket(encodePacket({ type: 'state', serial: 2, state: match.state(), world: serializeWorld(match.world()) }))).toThrow()
  })
})

describe('economic duel modes', () => {
  const start = (mode: 'budget' | 'resource') => { const m = createDuelMatch(244, mode); m.ready(0); m.ready(1); for (let i = 0; i < DUEL_RULES.countdown; i++) m.tick(IDLE_INPUT, IDLE_INPUT); return m }
  it('starts each seat with the same budget, validates real purchases, and locks a prepared loadout', () => {
    const m = createDuelMatch(7, 'budget'), w = m.world()
    expect(w.participants![1]!.shards).toBe(600); expect(w.participants![2]!.shards).toBe(600)
    expect(m.action(0, { kind: 'buy', id: 'gun-damage' })).toBe(true)
    expect(w.actors.get(1)!.attrs.damage).toBe(12); expect(w.actors.get(2)!.attrs.damage).toBe(10)
    expect(w.participants![2]!.shards).toBe(600); expect(w.participants![1]!.shards).toBe(590)
    expect(m.action(1, { kind: 'buy', id: 'ricochet' })).toBe(false)
    m.ready(0); expect(m.action(0, { kind: 'sell', id: 'gun-damage' })).toBe(false)
    m.ready(1); expect(w.actors.get(1)!.attrs.damage).toBe(12)
    expect(m.action(1, { kind: 'buy', id: 'gun-damage' })).toBe(false)
    expect(createDuelMatch(1).action(0, { kind: 'buy', id: 'gun-damage' })).toBe(false)
  })
  it('never grants income from time or PvP damage in budget mode, and refunds below paid price', () => {
    const m = start('budget'), w = m.world()
    for (let i = 0; i < 900; i++) m.tick(IDLE_INPUT, IDLE_INPUT)
    for (const [targetId, sourceId, sourceTeam] of [[1, 2, 'enemy'], [2, 1, 'player']] as const) applyDamage(w, { targetId, sourceId, sourceTeam, raw: 10, penetration: 0, isCore: false })
    expect(w.participants![1]!.shards).toBe(600); expect(w.participants![2]!.shards).toBe(600); expect(w.pickups).toEqual([]); expect(w.actors.size).toBe(2)
    m.action(1, { kind: 'buy', id: 'gun-damage' }); m.action(1, { kind: 'sell', id: 'gun-damage' })
    expect(w.participants![2]!.shards).toBe(596); expect(w.actors.get(2)!.attrs.damage).toBe(10)
  })
  it('replays deterministic resource/monster schedules with equal timed stipends', () => {
    const a = start('resource'), b = start('resource')
    for (let i = 0; i < 900; i++) { a.tick(IDLE_INPUT, IDLE_INPUT); b.tick(IDLE_INPUT, IDLE_INPUT) }
    expect(serializeWorld(a.world())).toEqual(serializeWorld(b.world()))
    expect(a.world().participants![1]!.shards).toBe(615); expect(a.world().participants![2]!.shards).toBe(615)
    expect(a.world().actors.size).toBeGreaterThan(2); expect(a.world().pickups.length).toBeGreaterThan(0)
    expect(() => decodePacket(encodePacket({ type: 'state', serial: 10, state: a.state(), world: serializeWorld(a.world(), true) }))).not.toThrow()
  })
  it('resets both builds and balances between rounds while preserving ordered plans', () => {
    const m = start('budget')
    m.action(1, { kind: 'plan', targets: [{ id: 'gun-damage', level: 1 }, { id: 'gun-range', level: 1 }, { id: 'gun-damage', level: 2 }] })
    m.action(1, { kind: 'buy', id: 'gun-damage' })
    applyDamage(m.world(), { targetId: 2, sourceId: 1, sourceTeam: 'player', raw: 1000, penetration: 0, isCore: false }); m.tick(IDLE_INPUT, IDLE_INPUT)
    expect(m.state().phase).toBe('round-over'); expect(m.world().participants![2]!.shards).toBe(600)
    expect(m.world().participants![2]!.purchases).toEqual([]); expect(m.state().plans[1].targets).toHaveLength(3)
    expect(m.world().actors.get(2)!.attrs.damage).toBe(10)
  })
  it('uses the same three-second ordered purchase delay for both seats', () => {
    const m = start('budget')
    for (const seat of [0, 1] as const) m.action(seat, { kind: 'plan', targets: [{ id: 'gun-damage', level: 1 }, { id: 'gun-range', level: 1 }, { id: 'gun-firerate', level: 1 }, { id: 'gun-damage', level: 2 }] })
    m.tick(IDLE_INPUT, IDLE_INPUT); expect(m.state().notices[0]?.remainingTicks).toBe(180)
    for (let i = 0; i < 179; i++) m.tick(IDLE_INPUT, IDLE_INPUT)
    expect(m.world().participants![1]!.purchases).toEqual([])
    m.tick(IDLE_INPUT, IDLE_INPUT)
    expect(m.world().participants![1]!.purchases[0]!.id).toBe('gun-damage'); expect(m.world().participants![1]).toEqual(m.world().participants![2])
    for (let i = 0; i < 181 * 3; i++) m.tick(IDLE_INPUT, IDLE_INPUT)
    expect(m.world().participants![1]!.purchases.map((p) => [p.id, p.level])).toEqual([['gun-damage', 2], ['gun-range', 1], ['gun-firerate', 1]])
  })
  it('lets monsters target and contact either player, with the same collision response', () => {
    const m = start('resource'), w = m.world(), host = w.actors.get(1)!, guest = w.actors.get(2)!
    const monster = createActor(w, { ...ENEMIES.drifter!, attrs: { ...ENEMIES.drifter!.attrs }, team: 'neutral', pos: { x: guest.pos.x - 30, y: guest.pos.y } })
    updateAi(w, new Set([1, 2])); expect(monster.intent.aim!.x).toBeGreaterThan(0)
    resolveContactDamage(w); expect(guest.hp).toBe(94); expect(host.hp).toBe(100)
    monster.pos = { x: host.pos.x + 30, y: host.pos.y }; resolveContactDamage(w); expect(host.hp).toBe(94)
    w.actors.delete(monster.id); host.pos = { x: 800, y: 700 }; guest.pos = { x: 840, y: 700 }; separateActors(w)
    expect(800 - host.pos.x).toBeCloseTo(guest.pos.x - 840)
  })
  it('collects into the correct wallet and allows both participants to revive independently', () => {
    const m = start('resource'), w = m.world(), guest = w.actors.get(2)!
    w.pickups.push({ id: allocateId(w), kind: 'shard', value: 14, pos: { ...guest.pos }, ttl: 600 }); updatePickups(w)
    expect(w.participants![2]!.shards).toBe(614); expect(w.participants![1]!.shards).toBe(600)
    for (const seat of [0, 1] as const) {
      expect(m.action(seat, { kind: 'buy', id: 'revive' })).toBe(true)
      const id = seat + 1; applyDamage(w, { targetId: id, sourceId: 2 - seat, sourceTeam: seat ? 'player' : 'enemy', raw: 1000, penetration: 0, isCore: false })
      expect(w.actors.get(id)!.alive).toBe(true); expect(w.actors.get(id)!.hp).toBe(50); expect(w.participants![id]!.revivesUsed).toBe(1)
    }
    expect(w.gameOver).toBe(false)
  })
  it('never counts hidden menu time toward the automatic purchase delay', () => {
    const m = start('budget'); m.action(0, { kind: 'queue', id: 'gun-damage' })
    for (let i = 0; i < 100; i++) m.tick(IDLE_INPUT, IDLE_INPUT)
    m.showOffers(0, false); for (let i = 0; i < 300; i++) m.tick(IDLE_INPUT, IDLE_INPUT)
    expect(m.world().participants![1]!.purchases).toEqual([]); expect(m.state().notices[0]).toBeNull()
    m.showOffers(0, true); m.tick(IDLE_INPUT, IDLE_INPUT); expect(m.state().notices[0]?.remainingTicks).toBe(180)
  })
  it('validates both wallets and rejects forged economic requests', () => {
    const m = start('budget'); m.action(1, { kind: 'buy', id: 'gun-damage' })
    expect(() => decodePacket(encodePacket({ type: 'state', serial: 2, state: m.state(), world: serializeWorld(m.world()) }))).not.toThrow()
    m.world().actors.get(2)!.attrs.damage++
    expect(() => decodePacket(encodePacket({ type: 'state', serial: 3, state: m.state(), world: serializeWorld(m.world()) }))).toThrow()
    const request = decodePacket(JSON.stringify({ protocol: DUEL_PROTOCOL, type: 'action', sequence: 1, round: 1, action: { kind: 'buy', id: 'gun-damage', shards: 999999, attrs: { damage: 999 } } }))
    expect(request.type === 'action' && request.action).toEqual({ kind: 'buy', id: 'gun-damage', level: undefined })
  })
})
