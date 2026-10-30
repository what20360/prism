import type { ConfigStorage } from './config'
export const SAVE_SLOTS = ['auto', 'slot-1', 'slot-2', 'slot-3'] as const
export type SaveSlot = typeof SAVE_SLOTS[number]
export const MAX_SAVE_BYTES = 2 * 1024 * 1024
function browserStorage(): ConfigStorage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
/** Slots are separate writes: a failed import/save never destroys another slot. */
export function createSaveStore(storage: ConfigStorage | undefined = browserStorage()) {
  return {
    read: (slot: SaveSlot): string | null => { try { return storage?.getItem(`prism.save.v1.${slot}`) ?? null } catch { return null } },
    write: (slot: SaveSlot, text: string): boolean => {
      if (!storage || new TextEncoder().encode(text).length > MAX_SAVE_BYTES) return false
      try { storage.setItem(`prism.save.v1.${slot}`, text); return true } catch { return false }
    },
  }
}
