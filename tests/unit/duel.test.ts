import { describe, expect, it } from 'vitest'
import { createDuelMatch, DUEL_RULES, DUEL_ATTRS } from '../../src/app/modes/duel'
import { cleanIntent, createRemoteInput, decodePacket, encodePacket, IDLE_INPUT } from '../../src/net/protocol'
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
