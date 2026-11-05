export type AimMode = 'auto' | 'manual'
export type FireMode = 'auto' | 'manual'
export type AutoSaveMode = 'room' | 'interval' | 'off'

/** Only player preferences are persisted; run state never belongs here. */
export interface ControlSettings {
  readonly autoSaveMode?: AutoSaveMode
  readonly autoSaveSeconds?: number
  readonly aimMode: AimMode
  readonly fireMode: FireMode
  readonly music?: boolean
  readonly sfx?: boolean
  readonly touchControls?: boolean
  readonly autoPickup?: boolean
}

export type SettingKey = keyof ControlSettings

export const DEFAULT_SETTINGS: ControlSettings = {
  autoSaveMode:'room',
  autoSaveSeconds:60,
  aimMode: 'manual',
  fireMode: 'manual',
  music: true,
  sfx: true,
  touchControls: false,
  autoPickup: true,
}

export const CONFIG_VERSION = 4
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
  if (!isRecord(value) || ![1, 2, 3, CONFIG_VERSION].includes(value.version as number) || !isRecord(value.settings)) {
    return { ...DEFAULT_SETTINGS }
  }

  const { aimMode, fireMode } = value.settings
  return {
    autoSaveMode:['room','interval','off'].includes(String(value.settings.autoSaveMode))?value.settings.autoSaveMode as AutoSaveMode:'room',
    autoSaveSeconds:typeof value.settings.autoSaveSeconds==='number'&&Number.isInteger(value.settings.autoSaveSeconds)&&value.settings.autoSaveSeconds>=5&&value.settings.autoSaveSeconds<=3600?value.settings.autoSaveSeconds:60,
    aimMode: value.version !== 1 && (aimMode === 'auto' || aimMode === 'manual') ? aimMode : DEFAULT_SETTINGS.aimMode,
    fireMode: value.version !== 1 && (fireMode === 'auto' || fireMode === 'manual') ? fireMode : DEFAULT_SETTINGS.fireMode,
    music: typeof value.settings.music === 'boolean' ? value.settings.music : true,
    sfx: typeof value.settings.sfx === 'boolean' ? value.settings.sfx : true,
    touchControls: value.settings.touchControls === true,
    autoPickup: value.settings.autoPickup !== false,
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
          settings: { autoSaveMode:settings.autoSaveMode??'room',autoSaveSeconds:settings.autoSaveSeconds??60,aimMode: settings.aimMode, fireMode: settings.fireMode, music: settings.music ?? true, sfx: settings.sfx ?? true, touchControls: settings.touchControls === true, autoPickup: settings.autoPickup !== false },
        }))
        return true
      } catch {
        return false
      }
    },
  }
}
