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
  let tap:{id:number;x:number;y:number;at:number}|undefined
  let pendingLock: { x: number; y: number } | null | undefined

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {if(tap&&tap.id===event.pointerId&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12)tap=undefined;return}
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
      tap={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now()}
      return
    }
    down = true
    onMove(event)
  }

  const onUp = (event: PointerEvent): void => {
    if(event.pointerType==='touch'){if(tap?.id!==event.pointerId)return;if(performance.now()-tap.at<=350&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12)pendingLock={x:event.clientX,y:event.clientY};tap=undefined;return}
    if (event.button !== 0) return
    down = false
  }

  const onLeave = (): void => {
    down = false
  }

  const onBlur = (): void => {
    tap=undefined;pendingLock = undefined
    down = false
  }

  const onCancel=(event:PointerEvent)=>{if(event.pointerType==='touch'){if(tap?.id===event.pointerId)tap=undefined}else down=false}
  const onContext = (event: Event) => event.preventDefault()
  target.addEventListener('contextmenu', onContext)
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  target.addEventListener('pointerleave', onLeave)
  target.addEventListener('pointercancel',onCancel)
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
      target.removeEventListener('pointercancel',onCancel)
      window.removeEventListener('blur', onBlur)
    },
  }
}
