import { describe, expect, it } from 'vitest'
import { createSaveManager } from '../../src/app/saveManager'
import { readCheckpoint, type RunCheckpoint } from '../../src/app/checkpoints'
import { createWorld } from '../../src/core/world'
import { serializeWorld } from '../../src/core/serialization'
import { buildDungeon } from '../../src/content/dungeon'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
function setup() {
  const values = new Map<string, string>(); let fail = false
  let current: RunCheckpoint = { format: 'prism-save', version: 1, savedAt: '2026-10-31T00:00:00Z', mode: 'dungeon', initialSeed: 8, restarts: 0, roomIndex: 0,
    world: serializeWorld(createWorld({ seed: 8, room: buildDungeon()[0]!, playerAttrs: PLAYER_BASE_ATTRS, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY })) }
  const manager = createSaveManager({ capture: () => current, setCurrentName: (name) => { current = { ...current, name } }, load: (saved) => { current = saved }, refresh: () => {},
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('quota'); values.set(key, value) } } })
  return { manager, values, capture: () => current, fail: () => { fail = true } }
}
function file(text: string): File { return { size: new TextEncoder().encode(text).length, text: async () => text } as File }
const key = (slot: string) => `prism.save.v1.${slot}`
describe('portable save names', () => {
  it('renames a saved slot without changing progress or timestamps, then preserves its name on overwrite', () => {
    const { manager, values, capture } = setup(); manager.handlers.onSave('slot-1'); const original = JSON.parse(values.get(key('slot-1'))!)
    manager.handlers.onRename('slot-1', '  飞剑挑战  ')
    const renamed = JSON.parse(values.get(key('slot-1'))!); expect(renamed.name).toBe('飞剑挑战'); expect(renamed.world).toEqual(original.world); expect(renamed.savedAt).toBe(original.savedAt)
    capture().world.shards = 200; manager.handlers.onSave('slot-1')
    expect(JSON.parse(values.get(key('slot-1'))!).name).toBe('飞剑挑战'); expect(JSON.parse(values.get(key('slot-1'))!).world.shards).toBe(200)
  })
  it('retains names through JSON round-trip and imports into empty or already named slots', async () => {
    const { manager, values } = setup(); manager.handlers.onSave('slot-1'); manager.handlers.onRename('slot-1', '流派一')
    const exported = JSON.stringify(readCheckpoint(values.get(key('slot-1'))!))
    await manager.handlers.onImport('slot-2', file(exported)); expect(manager.state().slots.find((s) => s.id === 'slot-2')?.name).toBe('流派一')
    manager.handlers.onRename('slot-2', '绝境备用'); await manager.handlers.onImport('slot-2', file(exported))
    expect(manager.state().slots.find((s) => s.id === 'slot-2')?.name).toBe('绝境备用')
    expect(readCheckpoint(JSON.stringify(readCheckpoint(values.get(key('slot-2'))!))).name).toBe('绝境备用')
  })
  it('retains the automatic slot name when updating its progress', () => {
    const { manager, values, capture } = setup(); manager.autoSave(); manager.handlers.onRename('auto', '正在探索')
    capture().world.shards = 135; manager.autoSave()
    expect(readCheckpoint(values.get(key('auto'))!).name).toBe('正在探索'); expect(readCheckpoint(values.get(key('auto'))!).world.shards).toBe(135)
  })
  it('keeps existing bytes when naming, import validation or storage writes fail', async () => {
    const { manager, values, fail } = setup(); manager.handlers.onSave('slot-1'); manager.handlers.onRename('slot-1', '保留')
    const old = values.get(key('slot-1'))!; manager.handlers.onRename('slot-1', ' '); expect(values.get(key('slot-1'))).toBe(old)
    await manager.handlers.onImport('slot-1', file(JSON.stringify({ ...readCheckpoint(old), name: 'x'.repeat(41) }))); expect(values.get(key('slot-1'))).toBe(old)
    fail(); manager.handlers.onRename('slot-1', '写入失败'); expect(values.get(key('slot-1'))).toBe(old)
  })
})
