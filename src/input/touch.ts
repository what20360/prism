import type { Intent } from '../core/controller'
import type { Snapshot } from '../core/snapshot'

export interface TouchSource {
  read(): Intent
  reset(): void
  setPaused(paused: boolean): void
  setVisible(visible: boolean): void
  update(snapshot: Snapshot, paused: boolean): void
  dispose(): void
}

/** Independent pointer captures let movement, aiming and actions coexist. */
export function createTouchControls(root: HTMLElement, onMenu: () => void): TouchSource {
  const layer = document.createElement('div')
  layer.className = 'touch-controls'
  layer.setAttribute('aria-label', '触屏战斗控制')
  const menu = document.createElement('button')
  menu.className = 'game-menu-button'
  menu.textContent = '☰ 菜单'
  menu.setAttribute('aria-label', '打开菜单')
  menu.addEventListener('click', onMenu)
  layer.append(menu)
  let move = { x: 0, y: 0 }
  let aim: { x: number; y: number } | undefined
  let firing = false
  let mine = false
  let skill = false
  let pendingMine = false
  let pendingSkill = false
  let paused = false
  const cleaners: (() => void)[] = []
  const resets: (() => void)[] = []

  function stick(kind: 'move' | 'fire', label: string): HTMLElement {
    const pad = document.createElement('div')
    pad.className = `touch-stick touch-stick--${kind}`
    pad.setAttribute('role', 'button')
    pad.setAttribute('aria-label', label)
    const thumb = document.createElement('span')
    thumb.className = 'touch-stick__thumb'
    const text = document.createElement('span')
    text.className = 'touch-stick__label'
    text.textContent = label
    pad.append(thumb, text)
    let pointer: number | null = null
    let origin = { x: 0, y: 0 }
    const clear = () => {
      if (pointer !== null && pad.hasPointerCapture(pointer)) pad.releasePointerCapture(pointer)
      pointer = null
      thumb.style.transform = ''
      pad.classList.remove('is-active')
      if (kind === 'move') move = { x: 0, y: 0 }
      else { firing = false; aim = undefined }
    }
    const update = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y
      const distance = Math.hypot(dx, dy)
      const radius = pad.clientWidth * 0.32
      const ratio = distance > radius ? radius / distance : 1
      thumb.style.transform = `translate(${dx * ratio}px, ${dy * ratio}px)`
      const direction = distance > 8 ? { x: dx / Math.max(distance, radius), y: dy / Math.max(distance, radius) } : { x: 0, y: 0 }
      if (kind === 'move') move = direction
      else aim = distance > 8 ? direction : undefined
      event.preventDefault()
    }
    pad.addEventListener('pointerdown', (event) => {
      if (paused || pointer !== null) return
      pointer = event.pointerId
      const rect = pad.getBoundingClientRect()
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      pad.setPointerCapture(pointer)
      pad.classList.add('is-active')
      if (kind === 'fire') firing = true
      update(event)
    })
    pad.addEventListener('pointermove', update)
    pad.addEventListener('pointerup', (event) => { if (event.pointerId === pointer) clear() })
    pad.addEventListener('pointercancel', clear)
    pad.addEventListener('lostpointercapture', clear)
    resets.push(clear)
    return pad
  }

  function action(label: string, className: string, set: (value: boolean) => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = `touch-action ${className}`
    button.textContent = label
    button.setAttribute('aria-label', label)
    button.addEventListener('pointerdown', (event) => {
      if (paused || button.disabled) return
      button.setPointerCapture(event.pointerId)
      set(true)
      event.preventDefault()
    })
    const release = () => set(false)
    button.addEventListener('pointerup', release)
    button.addEventListener('pointercancel', release)
    button.addEventListener('lostpointercapture', release)
    resets.push(release)
    return button
  }

  layer.append(stick('move', '移动'), stick('fire', '瞄准 / 射击'))
  const mineButton = action('地雷', 'touch-mine', (value) => { mine = value; pendingMine ||= value })
  const skillButton = action('偏转', 'touch-skill', (value) => { skill = value; pendingSkill ||= value })
  layer.append(mineButton, skillButton)
  root.append(layer)
  const reset = () => {
    for (const clear of resets) clear()
    pendingMine = false; pendingSkill = false
    paused = false
    layer.classList.remove('is-paused')
  }
  const setPaused = (value: boolean) => {
    if (paused === value) return
    for (const clear of resets) clear()
    pendingMine = false; pendingSkill = false
    paused = value
    layer.classList.toggle('is-paused', value)
  }
  const loseFocus = () => { for (const clear of resets) clear(); pendingMine = false; pendingSkill = false }
  window.addEventListener('blur', loseFocus)
  window.addEventListener('orientationchange', loseFocus)
  cleaners.push(() => window.removeEventListener('blur', loseFocus), () => window.removeEventListener('orientationchange', loseFocus))
  return {
    read: () => {
      if (paused) return { move: { x: 0, y: 0 }, fire: false }
      // A quick tap must survive until the next fixed simulation tick.
      const intent = { move, aim, fire: firing, placeMine: mine || pendingMine, skill: skill || pendingSkill ? 0 : undefined }
      pendingMine = false; pendingSkill = false
      return intent
    },
    reset, setPaused,
    setVisible: (visible) => layer.classList.toggle('touch-forced', visible),
    update: (snapshot, isPaused) => {
      setPaused(isPaused || snapshot.gameOver || snapshot.victory)
      const player = snapshot.actors.find((actor) => actor.team === 'player')
      if (!player) return
      for (const [button, remaining, total, label] of [
        [mineButton, player.mineCooldownSeconds, player.mineCooldownTotal, '地雷'],
        [skillButton, player.deflectCooldownSeconds, player.deflectCooldownTotal, '偏转'],
      ] as const) {
        const ratio = Math.max(0, Math.min(1, 1 - remaining / Math.max(0.01, total)))
        button.style.setProperty('--ready', `${ratio * 360}deg`)
        button.textContent = remaining > 0.3 ? `${label} ${remaining.toFixed(1)}` : label
      }
      skillButton.disabled = player.deflectLevel <= 0
      skillButton.title = skillButton.disabled ? '购买偏转力场后解锁' : '偏转 / 反射'
    },
    dispose: () => { loseFocus(); cleaners.forEach((clean) => clean()); layer.remove() },
  }
}
