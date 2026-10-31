import { bindings } from './bindings'
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

export function createKeyboardInput(target: Window): IntentSource {
  const pressed = new Set<string>()
  let restartRequested = false
  let menuToggleRequested = false

  const onKeyDown = (event: KeyboardEvent): void => {
    if (typeof Element !== 'undefined' && event.target instanceof Element && (event.target.matches('input,textarea,select') || (event.target as HTMLElement).isContentEditable)) return
    const map = bindings()
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === map.restart) {
      if (!event.repeat) restartRequested = true
      event.preventDefault()
      return
    }
    if (event.code === map.menu) {
      if (!event.repeat) menuToggleRequested = true
      event.preventDefault()
      return
    }
    if (!Object.values(map).includes(event.code) && !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) return
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
    const map = bindings()
    let x = 0
    let y = 0
    if (pressed.has(map.left) || pressed.has('ArrowLeft')) x -= 1
    if (pressed.has(map.right) || pressed.has('ArrowRight')) x += 1
    if (pressed.has(map.up) || pressed.has('ArrowUp')) y -= 1
    if (pressed.has(map.down) || pressed.has('ArrowDown')) y += 1

    return {
      move: normalize({ x, y }),
      placeMine: pressed.has(map.mine),
      skill: pressed.has(map.skill1) ? 0 : pressed.has(map.skill2) ? 1 : undefined,
      skills: [...(pressed.has(map.skill1) ? [0] : []), ...(pressed.has(map.skill2) ? [1] : [])],
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
