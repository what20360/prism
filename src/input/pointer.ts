export interface PointerSource {
  /** Latest pointer position in viewport (CSS) coordinates, or null before the first move. */
  position(): { x: number; y: number } | null
  /** True while the primary button is held. */
  firing(): boolean
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

  const onMove = (event: PointerEvent): void => {
    x = event.clientX
    y = event.clientY
    seen = true
  }

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
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
    down = false
  }

  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  target.addEventListener('pointerleave', onLeave)
  window.addEventListener('blur', onBlur)

  return {
    position: () => (seen ? { x, y } : null),
    firing: () => down,
    reset: onBlur,
    dispose: () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onBlur)
    },
  }
}
