import type { Intent } from '../core/controller'
import { normalize } from '../core/math'

export interface IntentSource {
  read(): Intent
  /** True once per press of the restart key. */
  consumeRestart(): boolean
  /** True once per press of the upgrade panel key. */
  consumePanelToggle(): boolean
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
  let panelToggleRequested = false

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyR') {
      restartRequested = true
      return
    }
    if (event.code === 'Tab') {
      panelToggleRequested = true
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
  const onBlur = (): void => {
    pressed.clear()
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

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

  const consumePanelToggle = (): boolean => {
    const requested = panelToggleRequested
    panelToggleRequested = false
    return requested
  }

  const dispose = (): void => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    target.removeEventListener('blur', onBlur)
  }

  return { read, consumeRestart, consumePanelToggle, dispose }
}