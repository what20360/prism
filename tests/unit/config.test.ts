import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_STORAGE_KEY,
  createSettingsStore,
  DEFAULT_SETTINGS,
  type ConfigStorage,
} from '../../src/storage/config'

afterEach(() => vi.unstubAllGlobals())

function memoryStorage(raw: string | null = null): ConfigStorage {
  const values = new Map<string, string>()
  if (raw !== null) values.set(CONFIG_STORAGE_KEY, raw)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('settings persistence', () => {
  it('migrates legacy automatic preferences to manual defaults', () => {
    const old = memoryStorage(JSON.stringify({ version: 1, settings: { aimMode: 'auto', fireMode: 'auto' } }))
    expect(createSettingsStore(old).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists independent music and sound effect preferences', () => {
    const storage = memoryStorage()
    createSettingsStore(storage).save({ ...DEFAULT_SETTINGS, music: false, sfx: true, touchControls: true })
    expect(createSettingsStore(storage).load()).toMatchObject({ music: false, sfx: true, touchControls: true })
  })
  it('migrates v2 controls and persists the magnet switch in v3', () => {
    const storage = memoryStorage(JSON.stringify({ version: 2, settings: { aimMode: 'auto', fireMode: 'manual', music: false } }))
    const store = createSettingsStore(storage)
    expect(store.load()).toMatchObject({ aimMode: 'auto', music: false, autoPickup: true })
    store.save({ ...store.load(), autoPickup: false })
    expect(createSettingsStore(storage).load().autoPickup).toBe(false)
    expect(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY)!).version).toBe(3)
  })
  it('loads defaults on first launch', () => {
    expect(createSettingsStore(memoryStorage()).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('restores both modes from the same storage on a later launch', () => {
    const storage = memoryStorage()
    const settings = { aimMode: 'manual', fireMode: 'manual' } as const
    expect(createSettingsStore(storage).save(settings)).toBe(true)
    expect(createSettingsStore(storage).load()).toEqual({ ...DEFAULT_SETTINGS, ...settings })
  })

  it('writes a versioned config containing preferences only', () => {
    const storage = memoryStorage()
    const settings = { aimMode: 'manual', fireMode: 'auto', tick: 42, shards: 100 } as const
    createSettingsStore(storage).save(settings)
    expect(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY) ?? '')).toEqual({
      version: 3,
      settings: { ...DEFAULT_SETTINGS, aimMode: 'manual', fireMode: 'auto' },
    })
  })

  it.each(['{broken', 'null', '[]', '{}', '{"version":99,"settings":{"aimMode":"manual"}}'])(
    'uses defaults for malformed or unsupported config: %s',
    (raw) => {
      expect(createSettingsStore(memoryStorage(raw)).load()).toEqual(DEFAULT_SETTINGS)
    },
  )

  it('keeps valid preferences while replacing missing or invalid fields', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 2,
      settings: { aimMode: 'unsupported', fireMode: 'manual' },
    }))
    expect(createSettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS)
    storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, settings: { aimMode: 'manual' } }))
    expect(createSettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('does not crash when storage reads or writes are denied', () => {
    const denied = () => { throw new Error('storage denied') }
    const store = createSettingsStore({ getItem: denied, setItem: denied })
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
    expect(store.save({ aimMode: 'manual', fireMode: 'manual' })).toBe(false)
  })

  it('handles browsers that deny access to the localStorage property itself', () => {
    vi.stubGlobal('window', {
      get localStorage() { throw new Error('storage denied') },
    })
    const store = createSettingsStore()
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
    expect(store.save(DEFAULT_SETTINGS)).toBe(false)
  })
})
