export interface PointerSource {
  /** Latest pointer position in viewport (CSS) coordinates, or null before the first move. */
  position(): { x: number; y: number } | null
  /** True while the primary button is held. */
  firing(): boolean
  consumeLock?(): { x: number; y: number } | null | undefined
  /** Releases the trigger while retaining the latest aim position. */
  reset(): void
  dispose(): void
}

/**
 * Mouse/pen input for manual aim and manual fire. Deliberately separate from the
 * keyboard source: movement and aiming are different devices even when both are
 * "just input".
 */
export function createPointerInput(target: HTMLElement): PointerSource {
  let x = 0
  let y = 0
  let seen = false
  let down = false
  let pendingLock: { x: number; y: number } | null | undefined

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    x = event.clientX
    y = event.clientY
    seen = true
  }

  const onDown = (event: PointerEvent): void => {
    if (event.button === 2 && event.pointerType !== 'touch') {
      pendingLock = { x: event.clientX, y: event.clientY }
      onMove(event)
      event.preventDefault()
      return
    }
    if (event.button !== 0) return
    if (event.pointerType === 'touch') {
      pendingLock = { x: event.clientX, y: event.clientY }
      return
    }
    down = true
    onMove(event)
  }

  const onUp = (event: PointerEvent): void => {
    if (event.button !== 0) return
    down = false
  }

  const onLeave = (): void => {
    down = false
  }

  const onBlur = (): void => {
    pendingLock = undefined
    down = false
  }

  const onContext = (event: Event) => event.preventDefault()
  target.addEventListener('contextmenu', onContext)
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  target.addEventListener('pointerleave', onLeave)
  window.addEventListener('blur', onBlur)

  return {
    position: () => (seen ? { x, y } : null),
    firing: () => down,
    consumeLock: () => { const value = pendingLock; pendingLock = undefined; return value },
    reset: onBlur,
    dispose: () => {
      target.removeEventListener('contextmenu', onContext)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onBlur)
    },
  }
}
