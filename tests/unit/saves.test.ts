import { describe, expect, it } from 'vitest'
import { ENEMIES } from '../../src/content/enemies'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { buildDungeon } from '../../src/content/dungeon'
import { createWorld, getPlayer, spawnEnemy } from '../../src/core/world'
import { restoreWorld, serializeWorld } from '../../src/core/serialization'
import { hashWorld } from '../../src/core/hash'
import { emitProjectile } from '../../src/core/systems/weapons'
import { tryPlaceMine } from '../../src/core/systems/mines'
import { buyCard } from '../../src/core/progress'
import { createEndlessMode } from '../../src/app/modes/endless'
import { readCheckpoint, type RunCheckpoint } from '../../src/app/checkpoints'
import { createSaveStore, MAX_SAVE_BYTES } from '../../src/storage/saveStore'
function world() { return createWorld({ seed: 123, room: buildDungeon()[0]!, playerAttrs: PLAYER_BASE_ATTRS, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY }) }
function checkpoint(): RunCheckpoint { return { format: 'prism-save', version: 1, savedAt: '2026-10-31T00:00:00.000Z', mode: 'dungeon', initialSeed: 123, restarts: 0, roomIndex: 0, world: serializeWorld(world()) } }
describe('complete run saves', () => {
  it('round-trips the deterministic world including live bullets, mines, paid cards, locks and RNG', () => {
    const a = world(), p = getPlayer(a); a.shards = 1000; buyCard(a, 'gun-pierce'); buyCard(a, 'homing'); emitProjectile(a, p, 0); tryPlaceMine(a, p)
    p.navTimer = -100; p.intent = { move: { x: 0, y: 0 }, aim: undefined, fire: false }; a.tick = 159; a.rng.state = 987654
    const b = restoreWorld(serializeWorld(a), CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    expect(hashWorld(b)).toBe(hashWorld(a)); expect(b.registry).toBe(CARD_REGISTRY); expect(b.projectiles).toHaveLength(1); expect(b.mines).toHaveLength(1)
    b.projectiles[0]!.pos = { ...b.projectiles[0]!.pos, x: b.projectiles[0]!.pos.x + 1 }; expect(b.projectiles[0]!.pos.x).not.toBe(a.projectiles[0]!.pos.x)
  })
  it('restores endless RNG, floor and queued replacements without re-entering the room', () => {
    const a = world(), mode = createEndlessMode(); mode.initialize(a); for (let i = 0; i < 4; i++) mode.advance(a)
    a.tick = 100; a.room.phase = 'combat'; const spawn = a.pendingSpawns[0]!; a.pendingSpawns = []
    const p = getPlayer(a); a.actors.set(300, { ...p, id: 300, team: 'enemy', alive: false, attrs: spawn.attrs })
    a.nextEntityId = 301; mode.afterStep(a)
    const data: RunCheckpoint = { ...checkpoint(), mode: 'endless', world: serializeWorld(a), endless: mode.checkpoint() }
    const loaded = readCheckpoint(JSON.stringify(data)), b = restoreWorld(loaded.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS)), other = createEndlessMode()
    other.restore(b, loaded.endless!); expect(other.state(b)).toEqual(mode.state(a)); expect(b.pickups).toEqual(a.pickups)
    a.tick += 61; b.tick += 61; mode.afterStep(a); other.afterStep(b)
    expect(hashWorld(a)).toBe(hashWorld(b)); expect(other.state(b)).toEqual(mode.state(a))
  })
  it('rejects unsupported versions, invalid numeric state, unknown cards and duplicated IDs', () => {
    const mutate = (change: (d: RunCheckpoint) => void) => { const data = checkpoint(); change(data); expect(() => readCheckpoint(JSON.stringify(data))).toThrow() }
    expect(() => readCheckpoint('{')).toThrow()
    expect(() => readCheckpoint(JSON.stringify({ ...checkpoint(), version: 9 }))).toThrow()
    mutate((d) => { d.world.actors.push(d.world.actors[0]!) })
    mutate((d) => { d.world.actors[0]!.hp = Infinity })
    mutate((d) => { d.world.purchases = [{ id: 'missing-card', level: 1 }] })
    mutate((d) => { d.world.actors[0]!.attrs.damage++ })
    expect(() => readCheckpoint(JSON.stringify(checkpoint()).replace('"world":{', '"world":{"__proto__":{},'))).toThrow()
    expect(() => readCheckpoint(' '.repeat(MAX_SAVE_BYTES + 1))).toThrow()
  })
  it('restores combat rooms containing melee enemies with zero gun range and speed', () => {
    const data = checkpoint(), a = world(); spawnEnemy(a, { ...ENEMIES.drifter!, pos: { x: 800, y: 600 } })
    const saved = { ...data, world: serializeWorld(a) }
    expect(() => readCheckpoint(JSON.stringify(saved))).not.toThrow()
  })
  it('retains difficulty, seeded waves and an in-progress warning across a JSON checkpoint', () => {
    const room = buildDungeon({ seed: 123, difficulty: 7 })[1]!, a = world();
    a.waves = { index: 1, total: 1 + room.waves!.length, remaining: room.waves!.map((w) => [...w]), countdown: 47, delayTicks: 90 }
    const data = { ...checkpoint(), difficulty: 7, roomIndex: 1, world: serializeWorld(a) }
    const saved = readCheckpoint(JSON.stringify(data)), b = restoreWorld(saved.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
    expect(saved.difficulty).toBe(7); expect(b.waves).toEqual(a.waves); expect(hashWorld(a)).toBe(hashWorld(b)); expect(b.waves!.countdown).toBe(47)
    b.waves!.countdown--; expect(hashWorld(a)).not.toBe(hashWorld(b))
  })
  it('keeps manual slots separate and preserves a saved slot if a later write fails', () => {
    const data = new Map<string, string>(); let fail = false
    const store = createSaveStore({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value) } })
    expect(store.write('slot-1', 'first')).toBe(true); expect(store.write('auto', 'automatic')).toBe(true)
    fail = true; expect(store.write('slot-1', 'second')).toBe(false); expect(store.read('slot-1')).toBe('first'); expect(store.read('auto')).toBe('automatic')
    expect(createSaveStore(undefined).write('auto', 'x')).toBe(false)
  })
})
