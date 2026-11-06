import { DEFAULT_SETTINGS, type ControlSettings } from '../storage/config'
import { SKILL_NAMES } from '../content/skills'
import type { Intent } from '../core/controller'
import type { Snapshot } from '../core/snapshot'

export interface TouchSource {
  configure?(settings:ControlSettings):void
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
  const full=document.createElement('button');full.className='touch-fullscreen';full.type='button';full.textContent='全屏';full.setAttribute('aria-label','切换全屏');full.hidden=typeof document.documentElement.requestFullscreen!=='function'
  full.onclick=()=>{loseFocus();const task=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();void task.catch(()=>{full.title='当前浏览器不支持全屏，可在浏览器菜单添加到主屏幕'})};layer.append(full)

  let settings:ControlSettings={...DEFAULT_SETTINGS}
  const detectDevice=()=>layer.classList.toggle('touch-device',Boolean(window.matchMedia?.('(pointer:coarse)').matches||navigator.maxTouchPoints>0))
  detectDevice()
  let move = { x: 0, y: 0 }
  let aim: { x: number; y: number } | undefined
  let firing = false
  let mine = false
  let skill = false
  let skill2 = false
  let pendingSkill2 = false
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
    const surface=kind==='move'?document.createElement('div'):pad
    if(kind==='move'){surface.className='touch-move-zone';surface.append(pad)}
    let pointer: number | null = null
    let origin = { x: 0, y: 0 }
    const clear = () => {
      const released=pointer;pointer=null
      if (released !== null && pad.hasPointerCapture(released)) pad.releasePointerCapture(released)
      thumb.style.transform = '';pad.style.left='';pad.style.top='';pad.style.bottom=''
      pad.classList.remove('is-active')
      if (kind === 'move') move = { x: 0, y: 0 }
      else firing = false
    }
    const update = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y
      const distance = Math.hypot(dx, dy)
      const radius = pad.clientWidth * 0.32
      const ratio = distance > radius ? radius / distance : 1
      thumb.style.transform = `translate(${dx * ratio}px, ${dy * ratio}px)`
      const deadzone=radius*(settings.touchDeadzone??.12),strength=Math.max(0,Math.min(1,(distance-deadzone)/Math.max(1,radius-deadzone)))
      const direction = distance>deadzone ? {x:dx/distance*strength,y:dy/distance*strength}:{x:0,y:0}
      if (kind === 'move') move = direction
      else if(distance>deadzone)aim=direction
      event.preventDefault()
    }
    surface.addEventListener('pointerdown', (event) => {
      if (paused || pointer !== null) return
      pointer = event.pointerId
      if(kind==='move'&&settings.touchStick==='floating'){const size=pad.getBoundingClientRect().width||pad.clientWidth;pad.style.left=`${Math.max(0,Math.min(window.innerWidth-size,event.clientX-size/2))}px`;pad.style.top=`${Math.max(0,Math.min(window.innerHeight-size,event.clientY-size/2))}px`;pad.style.bottom='auto'}
      const rect = pad.getBoundingClientRect()
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      pad.setPointerCapture(pointer)
      pad.classList.add('is-active')
      if (kind === 'fire') firing = true
      update(event)
    })
    pad.addEventListener('pointermove', update)
    pad.addEventListener('pointerup', (event) => { if (event.pointerId === pointer) clear() })
    pad.addEventListener('pointercancel', event=>{if(event.pointerId===pointer)clear()})
    pad.addEventListener('lostpointercapture', event=>{if(event.pointerId===pointer)clear()})
    resets.push(clear)
    return surface
  }

  function action(label: string, className: string, set: (value: boolean) => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = `touch-action ${className}`
    button.textContent = label
    button.setAttribute('aria-label', label)
    let owner:number|null=null
    button.addEventListener('pointerdown', (event) => {
      if (paused || button.disabled || owner!==null) return
      owner=event.pointerId;button.setPointerCapture(event.pointerId)
      set(true)
      event.preventDefault()
    })
    const release = () => {owner=null;set(false)}
    const end=(event:PointerEvent)=>{if(event.pointerId===owner)release()}
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', end)
    button.addEventListener('lostpointercapture', end)
    resets.push(release)
    return button
  }

  layer.append(stick('move', '移动'), stick('fire', '瞄准 / 射击'))
  const mineButton = action('地雷', 'touch-mine', (value) => { mine = value; pendingMine ||= value })
  const skillButton = action('偏转', 'touch-skill', (value) => { skill = value; pendingSkill ||= value })
  const secondSkillButton = action('技能2', 'touch-skill touch-skill--second', (value) => { skill2 = value; pendingSkill2 ||= value })
  layer.append(mineButton, skillButton, secondSkillButton)
  root.append(layer)
  const reset = () => {
    for (const clear of resets) clear()
    pendingMine = false; pendingSkill = false; pendingSkill2 = false;aim=undefined
    paused = false
    layer.classList.remove('is-paused')
  }
  const setPaused = (value: boolean) => {
    if (paused === value) return
    for (const clear of resets) clear()
    pendingMine = false; pendingSkill = false; pendingSkill2 = false
    aim=undefined;paused = value
    layer.classList.toggle('is-paused', value)
  }
  const loseFocus = () => { for (const clear of resets) clear();aim=undefined; pendingMine = false; pendingSkill = false; pendingSkill2 = false }
  const visibility=()=>{if(document.hidden)loseFocus()};document.addEventListener('visibilitychange',visibility);cleaners.push(()=>document.removeEventListener('visibilitychange',visibility))
  window.addEventListener('blur', loseFocus)
  window.addEventListener('orientationchange', loseFocus)
  const resized=()=>{loseFocus();detectDevice()};window.addEventListener('resize',resized)
  cleaners.push(()=>window.removeEventListener('resize',resized))
  cleaners.push(() => window.removeEventListener('blur', loseFocus), () => window.removeEventListener('orientationchange', loseFocus))
  return {
    configure:(value)=>{settings={...DEFAULT_SETTINGS,...value};loseFocus();layer.dataset.hand=settings.touchHand;layer.dataset.stick=settings.touchStick;layer.style.setProperty('--touch-scale',String((settings.touchSize??100)/100));layer.style.setProperty('--touch-opacity',String(settings.touchOpacity??.65));layer.style.setProperty('--touch-inset',`${settings.touchInset??18}px`);layer.classList.toggle('touch-forced',settings.touchControls===true)},
    read: () => {
      if (paused) return { move: { x: 0, y: 0 }, fire: false }
      // A quick tap must survive until the next fixed simulation tick.
      const intent = { move, aim, fire: firing, placeMine: mine || pendingMine, skills: [...(skill || pendingSkill ? [0] : []), ...(skill2 || pendingSkill2 ? [1] : [])] }
      pendingMine = false; pendingSkill = false; pendingSkill2 = false
      return intent
    },
    reset, setPaused,
    setVisible: (visible) => layer.classList.toggle('touch-forced', visible),
    update: (snapshot, isPaused) => {
      setPaused(isPaused || snapshot.gameOver || snapshot.victory)
      const player = snapshot.actors.find(actor=>actor.local===true)??snapshot.actors.find((actor) => actor.team === 'player')
      if (!player) return
      const mineRatio = Math.max(0, Math.min(1, 1 - player.mineCooldownSeconds / Math.max(0.01, player.mineCooldownTotal)))
      mineButton.style.setProperty('--ready', `${mineRatio * 360}deg`)
      mineButton.textContent = player.mineCooldownSeconds > 0.3 ? `地雷 ${player.mineCooldownSeconds.toFixed(1)}` : '地雷'
      for (const [index, button] of [skillButton, secondSkillButton].entries()) {
        const state = player.skills[index]
        const label = state?.id ? SKILL_NAMES[state.id] : `技能${index + 1}`
        button.disabled = !state?.id
        button.setAttribute('aria-label', `技能${index + 1}：${label}`)
        button.title = state?.id ? '在菜单的主动技能页换装' : '在主动技能页装备'
        button.style.setProperty('--ready', `${Math.max(0, Math.min(1, 1 - (state?.cooldown ?? 0) / Math.max(0.01, state?.total ?? 1))) * 360}deg`)
        button.textContent = (state?.cooldown ?? 0) > 0.3 ? `${label} ${state!.cooldown.toFixed(1)}` : label
        button.classList.toggle('is-skill-active', state?.active === true)
      }
    },
    dispose: () => { loseFocus(); cleaners.forEach((clean) => clean()); layer.remove() },
  }
}
