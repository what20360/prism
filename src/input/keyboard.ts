import type { Intent } from '../core/controller'
import { normalize } from '../core/math'

export interface IntentSource {
  read(): Intent
  /** True once per press of the restart key. */
  consumeRestart(): boolean
  /** True once per press of the menu key (Escape). */
  consumeMenuToggle(): boolean
  /** Clears held keys and queued actions when a new run starts. */
  reset(): void
  dispose(): void
}

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

const ACTION_KEYS = new Set(['KeyE', 'KeyJ'])

export function createKeyboardInput(target: Window): IntentSource {
  const pressed = new Set<string>()
  let restartRequested = false
  let menuToggleRequested = false

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'KeyR') {
      if (!event.repeat) restartRequested = true
      event.preventDefault()
      return
    }
    if (event.code === 'Escape') {
      if (!event.repeat) menuToggleRequested = true
      event.preventDefault()
      return
    }
    if (!MOVE_KEYS.has(event.code) && !ACTION_KEYS.has(event.code)) return
    pressed.add(event.code)
    event.preventDefault()
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code)
  }

  // Losing focus must not leave keys stuck down.
  const reset = (): void => {
    pressed.clear()
    restartRequested = false
    menuToggleRequested = false
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', reset)

  const read = (): Intent => {
    let x = 0
    let y = 0
    if (pressed.has('KeyA') || pressed.has('ArrowLeft')) x -= 1
    if (pressed.has('KeyD') || pressed.has('ArrowRight')) x += 1
    if (pressed.has('KeyW') || pressed.has('ArrowUp')) y -= 1
    if (pressed.has('KeyS') || pressed.has('ArrowDown')) y += 1

    return {
      move: normalize({ x, y }),
      placeMine: pressed.has('KeyE'),
      skill: pressed.has('KeyJ') ? 0 : undefined,
    }
  }

  const consumeRestart = (): boolean => {
    const requested = restartRequested
    restartRequested = false
    return requested
  }

  const consumeMenuToggle = (): boolean => {
    const requested = menuToggleRequested
    menuToggleRequested = false
    return requested
  }

  const dispose = (): void => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    target.removeEventListener('blur', reset)
  }

  return { read, consumeRestart, consumeMenuToggle, reset, dispose }
}
