export type AimMode = 'auto' | 'manual'
export type FireMode = 'auto' | 'manual'

/** Only player preferences are persisted; run state never belongs here. */
export interface ControlSettings {
  readonly aimMode: AimMode
  readonly fireMode: FireMode
}

export type SettingKey = keyof ControlSettings

export const DEFAULT_SETTINGS: ControlSettings = {
  aimMode: 'auto',
  fireMode: 'auto',
}

export const CONFIG_VERSION = 1
export const CONFIG_STORAGE_KEY = 'prism.config'

export interface ConfigStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SettingsStore {
  load(): ControlSettings
  save(settings: ControlSettings): boolean
}

function browserStorage(): ConfigStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // Some browser policies deny even access to the localStorage property.
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeSettings(value: unknown): ControlSettings {
  if (!isRecord(value) || value.version !== CONFIG_VERSION || !isRecord(value.settings)) {
    return { ...DEFAULT_SETTINGS }
  }

  const { aimMode, fireMode } = value.settings
  return {
    aimMode: aimMode === 'auto' || aimMode === 'manual' ? aimMode : DEFAULT_SETTINGS.aimMode,
    fireMode: fireMode === 'auto' || fireMode === 'manual' ? fireMode : DEFAULT_SETTINGS.fireMode,
  }
}

/** Storage is injected for tests; browser failures leave the current game usable. */
export function createSettingsStore(storage: ConfigStorage | undefined = browserStorage()): SettingsStore {
  return {
    load: () => {
      try {
        const raw = storage?.getItem(CONFIG_STORAGE_KEY)
        return raw ? decodeSettings(JSON.parse(raw) as unknown) : { ...DEFAULT_SETTINGS }
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    },
    save: (settings) => {
      if (!storage) return false
      try {
        storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({
          version: CONFIG_VERSION,
          settings: { aimMode: settings.aimMode, fireMode: settings.fireMode },
        }))
        return true
      } catch {
        return false
      }
    },
  }
}
