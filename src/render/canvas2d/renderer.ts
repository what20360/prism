import type { ControlSettings } from '../../storage/config'
import { weaponPalette } from './weaponPalette'
import { TRAIT_NAMES } from '../../content/monsterTraits'
import { ARSENAL_RULES } from '../../core/rules'
import { encounterName } from '../../content/encounters'
import { ENCOUNTER_RULES } from '../../core/systems/encounter'
import { firstWallHit } from '../../core/navigation'
import { WEAVER_RULES } from '../../core/weaverRules'
import type { EnergyTrace } from '../../core/world'
import type { PracticeState } from '../../app/modes/practice'
import type { EndlessState } from '../../app/modes/endless'
import type { ActorView, EffectView, FloaterView, Snapshot } from '../../core/snapshot'

export interface RenderDebug { readonly fps: number; readonly label?: string; readonly practice?: PracticeState; readonly endless?: EndlessState; readonly duel?: boolean; readonly seed?: number }
export interface CameraFocus { readonly x: number; readonly y: number; readonly vision: number }
export interface Renderer {
  configure?(settings:ControlSettings):void
  draw(snapshot: Snapshot, debug: RenderDebug): void
  viewToWorld(clientX: number, clientY: number, focus?: CameraFocus): { x: number; y: number }
  dispose(): void
}
interface Camera { x: number; y: number; width: number; height: number }
const CYAN = '#8cecff', PURPLE = '#ba9bff', GOLD = '#ffd591', RED = '#ff788e'

export function createCanvasRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas2D context is unavailable')
  const ctx = context
  let quality:ControlSettings['quality']='balanced'
  const compact=()=>width<760||height<500
  let width = 1, height = 1
  let safe={left:0,right:0,top:0,bottom:0}
  const hudSize=()=>({width:Math.max(1,width-safe.left-safe.right),height:Math.max(1,height-safe.top-safe.bottom)})
  let lastScene: Snapshot | undefined
  let camera: Camera = { x: 0, y: 0, width: 1920, height: 1080 }
  const resize = () => {
    width = canvas.clientWidth || window.innerWidth
    height = canvas.clientHeight || window.innerHeight
    const style=getComputedStyle(canvas),inset=(edge:string)=>Math.max(0,parseFloat(style.getPropertyValue('--safe-'+edge))||0)
    safe={left:inset('left'),right:inset('right'),top:inset('top'),bottom:inset('bottom')}
    const dpr = Math.min(quality==='low'?1:quality==='high'?2:1.5, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  window.addEventListener('resize', resize); resize()
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
  const text = (value: string, x: number, y: number, size = 14, color = '#b5c8d8') => {
    ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, SFMono-Regular, monospace`
    ctx.fillText(value, x, y)
  }
  const ring = (x: number, y: number, r: number, color: string, line = 2) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = line; ctx.stroke()
  }
  const cameraFor = (s: Snapshot, focus?: CameraFocus): Camera => {
    const aspect = width / height
    const player = focus ?? s.actors.find(a=>a.local===true) ?? s.actors.find((a) => a.team === 'player' && a.alive) ?? s.actors.find((a) => a.team === 'player')
    const viewWidth = Math.max(1080 * aspect, 1050) * (player?.vision ?? 1)
    const viewHeight = viewWidth / aspect
    const b = s.bounds
    const center = (value: number, start: number, extent: number, view: number) =>
      view >= extent ? start + extent / 2 : clamp(value, start + view / 2, start + extent - view / 2)
    return { x: center(player?.x ?? b.width / 2, b.x, b.width, viewWidth) - viewWidth / 2,
      // Portrait controls occupy the bottom edge; keep the pilot near the clear centre.
      y: compact() && height>width ? (player?.y ?? b.y + b.height / 2) - viewHeight * 0.46
        : center(player?.y ?? b.height / 2, b.y, b.height, viewHeight) - viewHeight / 2,
      width: viewWidth, height: viewHeight }
  }
  const drawArena = (s: Snapshot) => {
    ctx.fillStyle = '#0a1220'; ctx.fillRect(s.bounds.x, s.bounds.y, s.bounds.width, s.bounds.height)
    ctx.beginPath()
    for (let x = Math.floor(camera.x / 128) * 128; x < camera.x + camera.width; x += 128) {
      ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y + camera.height)
    }
    for (let y = Math.floor(camera.y / 128) * 128; y < camera.y + camera.height; y += 128) {
      ctx.moveTo(camera.x, y); ctx.lineTo(camera.x + camera.width, y)
    }
    ctx.strokeStyle = 'rgba(118,162,210,0.055)'; ctx.lineWidth = 1.5; ctx.stroke()
    if (s.design?.theme === 'silk' && s.design.core) {
      const room = s.design.core, x = room.x + room.width / 2, y = room.y + room.height / 2
      ctx.strokeStyle = 'rgba(211,166,255,0.12)'; ctx.lineWidth = 1.5
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 1500, y + Math.sin(a) * 1500); ctx.stroke() }
      for (let r = 90; r < 1300; r += 110) ring(x, y, r, 'rgba(211,166,255,0.08)', 1)
    }
    ctx.strokeStyle = '#243f5c'; ctx.lineWidth = 14
    ctx.strokeRect(s.bounds.x + 7, s.bounds.y + 7, s.bounds.width - 14, s.bounds.height - 14)
    ctx.strokeStyle = 'rgba(125,220,255,0.35)'; ctx.lineWidth = 2
    ctx.strokeRect(s.bounds.x + 22, s.bounds.y + 22, s.bounds.width - 44, s.bounds.height - 44)
    for (const wall of s.walls) {
      ctx.fillStyle = '#040a13'; ctx.fillRect(wall.x + 8, wall.y + 16, wall.width, wall.height)
      const gradient = ctx.createLinearGradient(wall.x, wall.y, wall.x, wall.y + wall.height)
      gradient.addColorStop(0, '#26394c'); gradient.addColorStop(1, '#111e30')
      ctx.fillStyle = gradient; ctx.fillRect(wall.x, wall.y, wall.width, wall.height)
      ctx.strokeStyle = '#46627e'; ctx.lineWidth = 2; ctx.strokeRect(wall.x, wall.y, wall.width, wall.height)
      ctx.fillStyle = 'rgba(143,221,246,0.22)'; ctx.fillRect(wall.x + 5, wall.y + 4, wall.width - 10, 3)
    }
    if (s.exit) {
      const e = s.exit, x = e.x + e.width / 2, y = e.y + e.height / 2
      ctx.fillStyle = 'rgba(150,227,202,0.08)'; ctx.fillRect(e.x, e.y, e.width, e.height)
      ring(x, y, 46, 'rgba(144,242,205,0.32)', 5)
      ring(x, y, 32, '#9bf3d2', 2)
      text('前往下一房间', x - 68, y + 85, 20, '#a6e6d0')
    }
  }
  const drawAim = (a: ActorView) => {
    const dx = Math.cos(a.aimAngle), dy = Math.sin(a.aimAngle)
    const length = clamp(a.range * 1.35, 480, 1100)
    const x = a.x + dx * length, y = a.y + dy * length
    const gradient = ctx.createLinearGradient(a.x, a.y, x, y)
    const hue = weaponPalette(a.team, a.damageType, 1, a.damage).hue
    gradient.addColorStop(0, `hsla(${hue},95%,83%,0.72)`)
    gradient.addColorStop(0.35, `hsla(${hue},95%,75%,0.25)`)
    gradient.addColorStop(1, `hsla(${hue},95%,75%,0)`)

    ctx.strokeStyle = gradient; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(a.x + dx * (a.radius + 16), a.y + dy * (a.radius + 16)); ctx.lineTo(x, y); ctx.stroke()
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.moveTo(a.x - dy * 8, a.y + dx * 8); ctx.lineTo(x, y); ctx.lineTo(a.x + dy * 8, a.y - dx * 8); ctx.fill()
    if (a.weapon === 1) {
      ctx.strokeStyle = `hsla(${hue},95%,80%,0.65)`; ctx.lineWidth = 2
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(a.x + dx * 70 - dy * side * 18, a.y + dy * 70 + dx * side * 18); ctx.lineTo(a.x + dx * 90, a.y + dy * 90); ctx.lineTo(a.x + dx * 112 - dy * side * 10, a.y + dy * 112 + dx * side * 10); ctx.stroke() }
    } else if (a.weapon === 2) {
      ring(a.x + dx * 130, a.y + dy * 130, 9, `hsla(${hue},95%,80%,0.7)`, 2)
    }
    const moving = Math.hypot(a.moveX, a.moveY)
    if (moving < 0.1) return
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(a.moveY, a.moveX))
    for (let i = 0; i < 3; i++) {
      const back = -a.radius - 12 - i * 17
      ctx.strokeStyle = `rgba(158,218,255,${0.35 - i * 0.1})`; ctx.lineWidth = 3 - i * 0.6
      ctx.beginPath(); ctx.moveTo(back - 12, -12); ctx.lineTo(back, 0); ctx.lineTo(back - 12, 12); ctx.stroke()
    }
    ctx.restore()
  }
  const cooldown = (a: ActorView, radius: number, remaining: number, total: number, minimum: number, color: string) => {
    if (total < minimum) return
    const start = -Math.PI * 0.83, span = Math.PI * 1.66
    ctx.lineCap = 'round'; ctx.lineWidth = 3.5
    ctx.beginPath(); ctx.arc(a.x, a.y, radius, start, start + span); ctx.strokeStyle = 'rgba(150,180,210,0.1)'; ctx.stroke()
    const progress = clamp(1 - remaining / Math.max(total, 0.001), 0, 1)
    if (progress > 0) {
      ctx.globalAlpha = remaining > 0 ? 0.85 : 0.25
      ctx.beginPath(); ctx.arc(a.x, a.y, radius, start, start + span * progress); ctx.strokeStyle = color; ctx.stroke(); ctx.globalAlpha = 1
    }
  }
  const drawActor = (a: ActorView, tick: number) => {
    const player = a.team === 'player', r = a.radius
    const silk = a.behavior === 'weaver' || Boolean(a.spider), worker = a.spider?.role === 'worker'
    if (player && a.local !== false && !a.stowed) drawAim(a)
    if (a.deflectFieldRadius > 0) {
      const glow = ctx.createRadialGradient(a.x, a.y, r, a.x, a.y, a.deflectFieldRadius)
      glow.addColorStop(0, a.deflectActive ? 'rgba(174,146,255,0.16)' : 'rgba(115,203,245,0.035)'); glow.addColorStop(1, 'rgba(100,190,255,0)')
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(a.x, a.y, a.deflectFieldRadius, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([12, 25]); ring(a.x, a.y, a.deflectFieldRadius, a.deflectActive ? '#b99bff' : 'rgba(155,208,255,0.16)', a.deflectActive ? 4 : 2); ctx.setLineDash([])
    }
    const color = player ? a.enraged ? GOLD : CYAN : a.team === 'neutral' ? GOLD : a.behavior === 'blocker' ? '#ff816c' : a.behavior === 'summoner' ? '#c7a1ff' : a.behavior === 'relay' ? '#8ee9ce' : a.behavior === 'charger' ? '#ffb164' : a.behavior === 'weaver' ? '#cea3ff' : worker ? GOLD : a.spider ? '#ff8ec7' : a.behavior === 'boss' ? PURPLE : RED
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(player || silk ? a.aimAngle : a.behavior === 'boss' ? tick * 0.003 : 0)
    if (silk) {
      ctx.strokeStyle = color; ctx.lineWidth = a.weaver ? 5 : 3
      for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
        const step = Math.sin(tick * 0.14 + i * 1.5) * (Math.hypot(a.moveX, a.moveY) > 0.1 ? 0.1 : 0.025)
        const x = r * (0.65 - i * 0.42), knee = x + r * (i < 2 ? 0.5 : -0.5)
        ctx.beginPath(); ctx.moveTo(x, side * r * 0.4); ctx.lineTo(knee, side * r * (0.9 + step)); ctx.lineTo(knee - r * 0.22, side * r * (1.35 + step)); ctx.stroke()
      }
    }
    ctx.beginPath()
    if (player) {
      ctx.moveTo(r, 0); ctx.lineTo(r * 0.1, r * 0.7); ctx.lineTo(-r * 0.65, r * 0.52)
      ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.65, -r * 0.52); ctx.lineTo(r * 0.1, -r * 0.7); ctx.closePath()
    } else {
      const count = a.behavior === 'weaver' ? 10 : worker ? 6 : a.spider ? 8 : a.behavior === 'boss' ? 6 : a.behavior === 'bomber' ? 8 : a.behavior === 'relay' ? 6 : a.behavior === 'charger' ? 3 : a.behavior === 'skirmish' ? 5 : a.behavior === 'turret' || a.behavior === 'lancer' ? 3 : 4
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count - Math.PI / 2
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      ctx.closePath()
    }
    ctx.shadowColor = color; ctx.shadowBlur = quality==='low'?0:player ? 16 : 9
    ctx.fillStyle = player ? '#18394b' : worker ? '#3b2b20' : '#341c32'; ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0
    if (a.coreRadius > 0) {
      ctx.fillStyle = player ? 'rgba(207,248,255,0.15)' : 'rgba(255,197,213,0.15)'
      ctx.beginPath(); ctx.arc(0, 0, a.coreRadius, 0, Math.PI * 2); ctx.fill()
      ring(0, 0, a.coreRadius, player ? '#c9f6ff' : '#ffd1dc', 1.5)
      ctx.fillStyle = player ? '#effcff' : '#ffe0ea'; ctx.beginPath(); ctx.arc(0, 0, Math.min(6, a.coreRadius * 0.4), 0, Math.PI * 2); ctx.fill()
    } else { ctx.fillStyle = color; ctx.fillRect(-4, -4, 8, 8) }
    if (silk) {
      for (const side of [-1, 1]) { ctx.fillStyle = '#fff0ee'; ctx.beginPath(); ctx.arc(r * 0.58, r * 0.22 * side, a.weaver ? 6 : 3, 0, Math.PI * 2); ctx.fill() }
      if (worker) ring(-r * 0.38, 0, r * 0.42, GOLD, 3)
      if (a.spider && !worker) ring(-r * 0.2, 0, r * (0.32 + Math.sin(tick * 0.2) * 0.05), a.spider.dashUsed ? '#ffc0dd' : '#ffffff', 2)
      if (a.weaver) {
        ctx.fillStyle = '#ecd2ff'; ctx.beginPath(); ctx.moveTo(r + 27, 0); ctx.lineTo(r + 8, -12); ctx.lineTo(r + 8, 12); ctx.closePath(); ctx.fill()
        for (let i = 0; i < 3; i++) { ctx.fillStyle = i < a.weaver.mineStock ? GOLD : '#433d4f'; ctx.fillRect(-22 + i * 18, -r - 26, 12, 10) }
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i < a.weaver.spiderStock ? '#ff8ec7' : '#433d4f'; ctx.beginPath(); ctx.arc(-35 + i * 14, r + 23, 4, 0, Math.PI * 2); ctx.fill() }
      }
    }
    ctx.restore()
    if (a.weaver && (a.weaver.volley > 0 && a.weaver.windup <= WEAVER_RULES.volleyWindup || a.weaver.shotTicks > 0)) {
      const span = 0.72
      ctx.save(); ctx.strokeStyle = '#f3b4e9'; ctx.fillStyle = 'rgba(232,128,223,0.07)'; ctx.setLineDash([12, 10]); ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, 500, a.aimAngle - span, a.aimAngle + span); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
    }
    if (player || a.weapon > 0) {
      const tint = weaponPalette(a.team, a.damageType, 1, a.damage).color
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.aimAngle); if (a.stowed) { ctx.translate(-r * 0.42, r * 0.35); ctx.rotate(-Math.PI * 0.72); ctx.scale(0.58, 0.7); ctx.globalAlpha = 0.65 } ctx.strokeStyle = tint; ctx.fillStyle = '#102838'; ctx.lineWidth = 3; ctx.shadowColor = tint; ctx.shadowBlur = quality==='low'?0:12
      if (a.weapon === 1) {
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.55, side * 10); ctx.lineTo(r + 13, side * 16); ctx.lineTo(r + 24, side * 7); ctx.stroke() }
        ring(r + 9, 0, a.channeling?8+Math.sin(tick*.9)*2:7, tint, a.channeling?3:2)
      } else if (a.weapon === 3) {
        ctx.fillRect(r * 0.25, -6, r + 13, 12); ctx.strokeRect(r * 0.25, -6, r + 13, 12)
        ctx.fillRect(r + 12, -3, 29, 6); ctx.strokeRect(r + 12, -3, 29, 6)
        ctx.fillRect(r * 0.7, -12, 16, 6); ctx.strokeRect(r * 0.7, -12, 16, 6)
      } else { ctx.fillRect(r * 0.5, -7, r * 0.7 + 12, 14); ctx.strokeRect(r * 0.5, -7, r * 0.7 + 12, 14); if (a.weapon === 2) ring(r + 21, 0, 11, tint, 2) }
      ctx.restore()
    }
    if (a.traits.includes('bark')) { ctx.setLineDash([13, 5]); ring(a.x, a.y, r + 10, '#b7a37b', 5); ctx.setLineDash([]) }
    if (a.shocked) ring(a.x, a.y, r + 15, '#a4bcff', 2)
    if (a.burning) ring(a.x, a.y, r + 19 + Math.sin(tick * 0.4) * 3, '#ffac72', 2)
    if (a.bombTicks !== null) {
      const radius = a.spider ? WEAVER_RULES.spiderBlast : ARSENAL_RULES.bombRadius
      ctx.fillStyle = `rgba(255,110,77,${0.04 + 0.05 * Math.sin(tick * 0.6) ** 2})`; ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([12, 10]); ring(a.x, a.y, radius, '#ff916f', 3); ctx.setLineDash([])
      ctx.textAlign = 'center'; text(`${(a.bombTicks / 60).toFixed(1)}s`, a.x, a.y - r - 30, 22, '#ffd7ac'); ctx.textAlign = 'left'
    }
    if (a.behavior==='relay'){ctx.setLineDash([8,6]);ring(a.x,a.y,r+12,'#93eed7',3);ctx.setLineDash([])}
    if (a.windupTicks !== null) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,124,95,0.55)'; ctx.lineWidth = a.behavior==='charger'?6:2; ctx.setLineDash([12, 12]); const start={x:a.x,y:a.y},length=a.behavior==='charger'?ENCOUNTER_RULES.chargeMax:a.range,end={x:a.x+Math.cos(a.windupAngle)*length,y:a.y+Math.sin(a.windupAngle)*length},wall=a.behavior==='charger'&&lastScene?firstWallHit(lastScene,start,end,a.radius):null;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x+(end.x-a.x)*(wall?.t??1),a.y+(end.y-a.y)*(wall?.t??1));ctx.stroke();ctx.restore()
      if(a.behavior==='charger'){ctx.textAlign='center';text(`冲刺 ${(a.windupTicks/60).toFixed(1)}s`,a.x,a.y-r-30,18,'#ffcb97');ctx.textAlign='left'}
    }
    if (a.shieldDisabledSeconds > 0 && player) { ctx.textAlign = 'center'; text(`禁盾 ${Math.ceil(a.shieldDisabledSeconds)}s`, a.x, a.y + r + 67, 15, '#ff9dba'); ctx.textAlign = 'left' }
    if (a.shield > 0) ring(a.x, a.y, r + 5, 'rgba(180,210,255,0.5)', 2)
    if (player) {
      cooldown(a, r + 13, a.fireCooldownSeconds, a.fireCooldownTotal, 0.3, CYAN)
      for (const [index, skill] of a.skills.entries()) if (skill.id) cooldown(a, r + 23 + index * 11, skill.cooldown, skill.total, 0.5, skill.id === 'rage' ? RED : skill.id === 'dash' ? '#9feac7' : PURPLE)
      if (a.mineCooldownSeconds > 0) cooldown(a, r + 46, a.mineCooldownSeconds, a.mineCooldownTotal, 0.5, GOLD)
    }
    if (a.locked) {
      const edge = r + 16, inset = 12
      ctx.strokeStyle = a.manualLocked ? GOLD : CYAN; ctx.lineWidth = 3
      ctx.beginPath()
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        ctx.moveTo(a.x + x * edge, a.y + y * (edge - inset)); ctx.lineTo(a.x + x * edge, a.y + y * edge); ctx.lineTo(a.x + x * (edge - inset), a.y + y * edge)
      }
      ctx.stroke()
    }
    if (player && a.name) { ctx.textAlign='center';text(a.local===false?a.name:a.name+'（你）',a.x,a.y-r-30,14,a.local===false?'#a2edbc':CYAN);ctx.textAlign='left' }
    if (a.weaver) text(`雷 ${a.weaver.mineStock}/3 · 蛛 ${a.weaver.spiderStock}/6`, a.x - r, a.y + r + 55, 12, '#e4c3ed')
    if (!player && (a.weaver || a.hp < a.maxHp || a.damageFlashTicks > 0)) {
      const ratio = clamp(a.hp / a.maxHp, 0, 1)
      ctx.fillStyle = '#09101b'; ctx.fillRect(a.x - r, a.y - r - 20, r * 2, 5)
      ctx.fillStyle = color; ctx.fillRect(a.x - r, a.y - r - 20, r * 2 * ratio, 5)
      if (a.weaver || a.damageFlashTicks > 0) {
        ctx.textAlign = 'center'
        text(a.name ?? '敌人', a.x, a.y - r - 54, 18, '#e3c7d9')
        text(`${Math.ceil(a.hp)} / ${Math.round(a.maxHp)}  护甲 ${Math.round(a.armor)}  格挡 ${Number(a.block.toFixed(1))}`, a.x, a.y - r - 32, 14, '#aebed0')
        ctx.textAlign = 'left'
      }
    }
  }
  const drawEffect = (e: EffectView) => {
    const alpha = clamp(e.ttl / 18, 0, 1), progress = 1 - alpha
    const color = e.kind === 'block' ? '#d4c49b' : e.kind === 'explosion' ? GOLD : e.kind === 'coreHit' || e.kind === 'reflect' ? PURPLE : e.kind === 'death' ? RED : CYAN
    ctx.globalAlpha = alpha
    ring(e.x, e.y, e.radius * (0.3 + progress), color, Math.max(1, 5 * alpha))
    if (e.kind === 'block') text('格挡', e.x - 15, e.y - e.radius - 10, 13, color)
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399, radius = e.radius * progress
      ctx.fillStyle = color; ctx.fillRect(e.x + Math.cos(angle) * radius, e.y + Math.sin(angle) * radius, 4 * alpha + 1, 4 * alpha + 1)
    }
    ctx.globalAlpha = 1
  }
  const drawFloater = (f: FloaterView) => {
    ctx.globalAlpha = Math.min(1, f.ttl / 20); ctx.textAlign = 'center'
    const value = Math.round(f.value * 100) / 100
    const amount=f.value>0&&f.value<1?f.value<.01?'<0.01':String(value):String(Math.round(value))
    const label = f.kind === 'shard' ? `◆ ${value}` : f.kind === 'overflow' ? `溢 ${Math.round(value)}` : f.kind === 'taken' ? `−${amount}` : f.kind === 'heal' ? `+${amount}` : amount
    const color = f.kind === 'shard' ? '#91eacb' : f.kind === 'overflow' ? GOLD : f.kind === 'taken' ? RED : f.kind === 'heal' ? '#9ff4c3' : '#e7f5ff'
    ctx.shadowColor = '#02050c'; ctx.shadowBlur = 5; text(label, f.x, f.y, f.kind === 'shard' ? 19 : 25, color)
    ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.globalAlpha = 1
  }
  const drawHud = (s: Snapshot, debug: RenderDebug) => {
    const {width,height}=hudSize()
    if(compact()){
      const p=s.actors.find(a=>a.local===true)??s.actors.find(a=>a.team==='player')
      if(p){text(`HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)}${p.shield>0?' 盾'+Math.ceil(p.shield):''}`,12,27,13,p.hp<p.maxHp*.3?RED:CYAN);ctx.fillStyle='#203245';ctx.fillRect(12,35,142,4);ctx.fillStyle=CYAN;ctx.fillRect(12,35,142*clamp(p.hp/p.maxHp,0,1),4)
       text(`◆ ${Math.floor(s.shards)} · ${p.weapon===1?'持续电弧':p.weapon===2?'激光':p.weapon===3?'狙击':'弹芯枪'}`,12,58,12,GOLD)
       if(p.shieldDisabledSeconds>0)text(`禁盾 ${Math.ceil(p.shieldDisabledSeconds)}s`,12,77,11,RED)
      }
      text(((s.design?.title??debug.label??'')+(encounterName(s.design?.encounter)?' · '+encounterName(s.design?.encounter):'')).slice(0,25),12,94,11,'#8ba9bc')
      if(s.wave?.countdown)text(`下一波 ${(s.wave.countdown/60).toFixed(1)}s`,12,111,12,GOLD)
      if(s.coop)for(const [i,m]of s.coop.members.filter(m=>m.id!==p?.id).entries()){const a=s.actors.find(a=>a.id===m.id);text(`${m.name.slice(0,8)} ${!m.connected?'离线':a?.alive?Math.ceil(a.hp)+'HP':'复活'+(m.reviveTicks/60).toFixed(1)+'s'}`,12,128+i*16,10,'#9bcabf')}
      const size=72,mapX=width>height?width/2-size/2:width-size-12,mapY=width>height?10:112,sy=size*s.bounds.height/s.bounds.width
      ctx.fillStyle='#030c17b8';ctx.fillRect(mapX,mapY,size,sy);ctx.strokeStyle='#375563';ctx.strokeRect(mapX,mapY,size,sy)
      const scale=size/s.bounds.width;ctx.fillStyle='#385467';for(const wall of s.walls)ctx.fillRect(mapX+(wall.x-s.bounds.x)*scale,mapY+(wall.y-s.bounds.y)*scale,wall.width*scale,wall.height*scale)
      for(const a of s.actors)if(a.alive){ctx.fillStyle=a.local?CYAN:a.team==='player'?'#a4bfff':a.behavior==='relay'?'#8ee9ce':a.behavior==='charger'?'#ffb164':RED;ctx.fillRect(mapX+(a.x-s.bounds.x)*scale-1.5,mapY+(a.y-s.bounds.y)*scale-1.5,3,3)}
      if(s.exit){ctx.fillStyle='#9ff3ba';ctx.fillRect(mapX+(s.exit.x-s.bounds.x)*scale,mapY+(s.exit.y-s.bounds.y)*scale,5,4)}
      if(s.awaitsEntry||s.roomCleared){ctx.textAlign='center';text(s.awaitsEntry?'向前移动，进入战斗':'已清空 · 前往传送门',width/2,height*.38,12,'#99d8c5');ctx.textAlign='left'}
      return
    }

    const phone = width < 700, p = s.actors.find(a=>a.local===true)??s.actors.find((a) => a.team === 'player')
    text(`P R I S M${p ? ' · ' + (p.weapon === 1 ? '电弧' : p.weapon === 2 ? '激光' : p.weapon === 3 ? '狙击手' : '弹芯枪') : ''}`, 20, 29, 15, p ? weaponPalette('player', p.damageType, 1, p.damage).color : CYAN)
    if (s.design) { ctx.textAlign = 'center'; text(s.design.title+(encounterName(s.design.encounter)?' · '+encounterName(s.design.encounter):''), width / 2, 30, 16, s.design.theme === 'silk' ? '#d6b0ed' : '#96bbc7'); ctx.textAlign = 'left' }
    text(`${debug.label ?? ''}  /  ${debug.duel ? '联网对战' : debug.endless ? debug.endless.open ? '开放层' : '清场层' : debug.practice ? debug.practice.config.scenario === 'targets' ? '固定靶机' : '敌人演练' : s.roomKind === 'safe' ? '安全区' : s.roomKind === 'boss' ? '核心决战' : '探索中'}`, 20, 49, 11, '#6f90ac')
    if (p) {
      const barWidth = phone ? 142 : 210
      ctx.fillStyle = '#192538'; ctx.fillRect(20, 65, barWidth, 5)
      ctx.fillStyle = p.hp < p.maxHp * 0.3 ? RED : CYAN; ctx.fillRect(20, 65, barWidth * clamp(p.hp / p.maxHp, 0, 1), 5)
      text(`${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}${p.shieldDisabledSeconds > 0 ? `  禁盾 ${Math.ceil(p.shieldDisabledSeconds)}s` : p.shield > 0 ? `  ◇${Math.ceil(p.shield)}` : p.stowed ? '  已收枪' : ''}`, 20, 90, 12, '#d6e6f3')
      text(debug.duel ? `◆ ${Math.floor(s.shards)} · J / K 主动技能` : debug.practice ? `${debug.practice.config.invincible ? '无敌开启' : '可受伤'} · ${debug.practice.config.freeCards ? '自由购卡' : '限额购卡'}` : `◆ ${Math.floor(s.shards)}   击破 ${s.stats.kills}`, 20, 111, 12, GOLD)
      if (debug.endless) {
        text(`种子 ${debug.endless.seed} · 敌人 ${debug.endless.alive + debug.endless.pending}`, 20, 133, 11, PURPLE)
        if (!phone) text(debug.endless.open ? `传送门开放 · 下次补刷收益 ${Number((debug.endless.nextReward * 100).toFixed(1))}%` : '清空敌人，开启下一层', 20, 153, 11, '#8ad9bb')
      } else if (debug.seed !== undefined) {
        text(`种子 ${debug.seed}${s.wave ? ` · 波次 ${s.wave.index}/${s.wave.total}` : ''}`, 20, 133, 11, PURPLE)
        if (s.wave?.countdown) text(`下一波 ${(s.wave.countdown / 60).toFixed(1)} 秒`, 20, 153, 12, GOLD)
      } else if (s.stats.chain > 1 && !debug.practice) text(`连击 ×${s.stats.chain}`, 20, 133, 12, PURPLE)
      if (!phone) {
        text(p.autoFire ? '扳机模组已装备' : '按住左键射击 · 右键目标锁定 · 右键空白取消', 20, height - 25, 12, '#7591a9')
        for (const [i, skill] of p.skills.entries()) if (skill.id) {
          const name = skill.id === 'deflect' ? '偏转' : skill.id === 'rage' ? '狂暴' : '冲刺'
          text(`${i === 0 ? 'J' : 'K'}  ${name}  ${skill.active ? '生效中' : skill.cooldown > 0 ? skill.cooldown.toFixed(1) + 's' : '就绪'}`, width / 2 - 115 + i * 170, height - 25, 12, PURPLE)
        }
      }
    }
    if(s.coop) { const rows=s.coop.members; for(const [index,m] of rows.entries()){const a=s.actors.find(a=>a.id===m.id);text(`${m.name} · ${!m.connected?'离线':!a?.alive?s.gameOver?'倒地':'复活 '+(m.reviveTicks/60).toFixed(1)+'s':Math.ceil(a.hp)+' HP'}`,20,190+index*20,12,m.connected?'#a5e9d1':'#7f8a99')} }
    const mw = phone ? 100 : 180, mh = mw * s.bounds.height / s.bounds.width, mx = width - mw - 18, my = 66
    ctx.fillStyle = 'rgba(3,8,17,0.8)'; ctx.fillRect(mx, my, mw, mh)
    ctx.strokeStyle = '#29425d'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh)
    const sx = mw / s.bounds.width, sy = mh / s.bounds.height
    ctx.fillStyle = '#334a65'
    for (const wall of s.walls) ctx.fillRect(mx + wall.x * sx, my + wall.y * sy, wall.width * sx, wall.height * sy)
    for (const a of s.actors) {
      if (!a.alive) continue
      ctx.fillStyle = a.team === 'player' ? CYAN : a.team === 'neutral' ? GOLD : a.behavior==='relay'?'#8ee9ce':a.behavior==='charger'?'#ffb164':RED; ctx.fillRect(mx + a.x * sx - 2, my + a.y * sy - 2, 4, 4)
    }
    if (s.exit) { ctx.fillStyle = '#97e5c2'; ctx.fillRect(mx + s.exit.x * sx, my + s.exit.y * sy, Math.max(4, s.exit.width * sx), Math.max(3, s.exit.height * sy)) }
    ctx.textAlign = 'center'
    if (s.awaitsEntry) text('向前移动，进入战斗区域', width / 2, phone ? height * 0.42 : height - 58, phone ? 12 : 14, '#afc6d9')
    else if (s.roomCleared) text('区域已净空 · 前往传送门', width / 2, phone ? height * 0.43 : height - 58, phone ? 12 : 14, '#8ad9bb')
    ctx.textAlign = 'left'
  }
  const drawPractice = (debug: RenderDebug) => {
    const {width}=hudSize()
    const state = debug.practice
    if (!state) return
    if (compact()) { text(`伤害 ${Number(state.damage.toFixed(1))} · DPS ${state.recentDps.toFixed(1)}`, width>height?width-215:12, width>height?82:112, 10, CYAN); return }
    ctx.fillStyle = 'rgba(5,14,25,0.88)'; ctx.fillRect(18, 150, 205, 100)
    ctx.strokeStyle = '#294f60'; ctx.lineWidth = 1; ctx.strokeRect(18, 150, 205, 100)
    text(`总伤害  ${state.damage.toFixed(1)}`, 30, 174, 12, CYAN)
    text(`近3秒DPS  ${state.recentDps.toFixed(1)}`, 30, 201, 12, '#cadbe6')
    text(`平均DPS  ${state.averageDps.toFixed(1)}`, 30, 228, 12, '#90a9bb')
  }
  const drawTarget = (s: Snapshot) => {
    const {width,height}=hudSize()
    const target = s.actors.find((a) => a.locked && a.alive)
    if (!target) return
    if(compact()){
      const landscape=width>height,w=landscape?Math.min(220,width-300):Math.min(238,width-24),x=landscape?(width-w)/2:12,y=landscape?height-80:s.coop?195:130
      ctx.fillStyle='#091524ed';ctx.fillRect(x,y,w,68);ctx.strokeStyle=target.manualLocked?GOLD:CYAN;ctx.strokeRect(x,y,w,68)
      text(`${target.manualLocked?'◆':'◇'} ${(target.name??'目标').slice(0,16)}`,x+8,y+17,11,GOLD)
      text(`HP ${Math.ceil(target.hp)}/${Math.round(target.maxHp)} 盾${Math.ceil(target.shield)}`,x+8,y+36,11)
      text(`甲${Math.round(target.armor)} 格挡${Number(target.block.toFixed(1))} 伤害${Number(target.damage.toFixed(1))}${target.bombTicks!==null?' ⚠引爆':target.windupTicks!==null?' ⚠蓄能':''}`,x+8,y+55,10)
      return
    }
    const phone = width < 700, w = phone ? 220 : 260, x = phone ? 20 : width - w - 18, y = phone ? 150 : 190
    const h = target.rewardMultiplier < 1 ? 193 : 173
    ctx.fillStyle = 'rgba(5,14,25,0.92)'; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = target.manualLocked ? '#9c8354' : '#37687d'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h)
    text(`${target.manualLocked ? '◆' : '◇'} ${(target.name ?? '目标').slice(0, 18)}`, x + 10, y + 19, 11, target.manualLocked ? GOLD : CYAN)
    ctx.fillStyle = '#253244'; ctx.fillRect(x + 10, y + 29, w - 20, 3)
    ctx.fillStyle = RED; ctx.fillRect(x + 10, y + 29, (w - 20) * clamp(target.hp / target.maxHp, 0, 1), 3)
    text(`生命 ${Math.ceil(target.hp)} / ${Math.round(target.maxHp)}   盾 ${Math.ceil(target.shield)}`, x + 10, y + 49, 11)
    text(`护甲 ${Math.round(target.armor)}   格挡 ${Number(target.block.toFixed(1))}`, x + 10, y + 70, 11)
    text(`伤害 ${Number(target.damage.toFixed(1))}   攻速 ${Number(target.fireRate.toFixed(2))}/s`, x + 10, y + 91, 11)
    text(`抗性 物${Math.round(target.physicalResist)} / 电${Math.round(target.electricResist)} / 热${Math.round(target.heatResist)}`, x + 10, y + 112, 11)
    text(`词条 ${target.traits.map((t) => TRAIT_NAMES[t]).join(' · ') || '无'}`, x + 10, y + 133, 11, GOLD)
    text(`移速 ${Math.round(target.movementSpeed)} · ${target.damageType === 'electric' ? '电伤' : target.damageType === 'heat' ? '热伤' : '物理'}${target.bombTicks !== null ? ' · 引爆中' : target.windupTicks !== null ? ' · 蓄能中' : ''}`, x + 10, y + 154, 11)
    if (target.rewardMultiplier < 1) text(`棱晶收益 ${Number((target.rewardMultiplier * 100).toFixed(2))}%`, x + 10, y + 175, 11, GOLD)
  }
  const drawBullet = (bullet: Snapshot['projectiles'][number]) => {
    // Absolute remaining range also matters: a short-lived shot starts visibly depleted.
    const energy = Math.min(bullet.rangeRatio, bullet.rangeLeft / 700)
    const { hue, color, halo, alpha } = weaponPalette(bullet.team, bullet.damageType, energy, bullet.power)
    const r = Math.max(2.5, bullet.radius), speed = bullet.speed
    ctx.save(); ctx.globalAlpha = alpha
    // Follow the actual previous path, including bends, using a tapering filled ribbon.
    const path = [...(quality==='low'?bullet.trail.slice(-3):bullet.trail), { x: bullet.x, y: bullet.y }]
    let budget = Math.min(190, speed * 0.12), length = 0
    const points = [{ x: bullet.x, y: bullet.y }]
    for (let i = path.length - 2; i >= 0 && budget > 0; i--) {
      const from = points.at(-1)!, to = path[i]!, d = Math.hypot(to.x - from.x, to.y - from.y)
      if (d < 0.01) continue
      const f = Math.min(1, budget / d)
      points.push({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }); budget -= d * f; length += d * f
    }
    if (length > r && speed > 40) {
      const tail = points.at(-1)!, fade = ctx.createLinearGradient(tail.x, tail.y, bullet.x + 0.01, bullet.y + 0.01)
      fade.addColorStop(0, `hsla(${hue}, 85%, 86%, 0)`); fade.addColorStop(0.6, `hsla(${hue}, 95%, 75%, 0.5)`); fade.addColorStop(1, color)
      ctx.fillStyle = fade; ctx.beginPath()
      const side = (sign: number) => {
        let traveled = 0
        for (let i = 0; i < points.length; i++) {
          const p = points[i]!, prev = points[Math.max(0, i - 1)]!, next = points[Math.min(points.length - 1, i + 1)]!
          if (i) traveled += Math.hypot(p.x - prev.x, p.y - prev.y)
          const dx = prev.x - next.x, dy = prev.y - next.y, d = Math.hypot(dx, dy) || 1
          const w = r * 0.92 * Math.max(0, 1 - traveled / length)
          const x = p.x - dy / d * w * sign, y = p.y + dx / d * w * sign
          if (i === 0 && sign === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
      }
      side(1)
      // Reverse the opposite edge so the tail has one continuous pointed silhouette.
      const edge: { x: number; y: number }[] = []; let traveled = 0
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!, prev = points[Math.max(0, i - 1)]!, next = points[Math.min(points.length - 1, i + 1)]!
        if (i) traveled += Math.hypot(p.x - prev.x, p.y - prev.y)
        const dx = prev.x - next.x, dy = prev.y - next.y, d = Math.hypot(dx, dy) || 1, w = r * 0.92 * Math.max(0, 1 - traveled / length)
        edge.push({ x: p.x + dy / d * w, y: p.y - dx / d * w })
      }
      for (const p of edge.reverse()) ctx.lineTo(p.x, p.y)
      ctx.closePath(); ctx.fill()
    }
    const glow = ctx.createRadialGradient(bullet.x, bullet.y, r * 0.6, bullet.x, bullet.y, r * 2)
    glow.addColorStop(0, halo); glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, r * 2, 0, Math.PI * 2); ctx.fill()
    // Dense colored shell and small hot core, without a hollow outer ring.
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = `hsl(${hue}, ${20 + energy * 40}%, 98%)`; ctx.beginPath(); ctx.arc(bullet.x - r * 0.18, bullet.y - r * 0.18, r * 0.45, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  const drawEnergy = (beam: EnergyTrace, tick: number) => {
    const type = beam.damageType ?? (beam.kind === 'electric' ? 'electric' : 'heat'), palette = weaponPalette(beam.team, type, beam.rangeRatio, beam.power)
    const dx = beam.to.x - beam.from.x, dy = beam.to.y - beam.from.y, length = Math.hypot(dx, dy)
    ctx.save(); ctx.globalAlpha = Math.min(1, beam.ttl / 4) * palette.alpha; ctx.shadowColor = palette.color; ctx.shadowBlur = quality==='low'?0:beam.kind === 'electric' ? 14 : 20
    ctx.lineWidth = Math.max(2, Math.min(14, beam.width * 0.3 + Math.log2(1 + beam.power) * 0.4)); ctx.strokeStyle = palette.color
    ctx.beginPath(); ctx.moveTo(beam.from.x, beam.from.y)
    const count = beam.kind === 'electric' ? Math.max(2, Math.min(40, Math.ceil(length / 30))) : 1
    for (let i = 1; i <= count; i++) {
      const t = i / count, wiggle = i === count || beam.kind !== 'electric' ? 0 : Math.sin(i * 5.8 + tick * 0.9 + beam.ownerId) * 9
      ctx.lineTo(beam.from.x + dx * t - dy / Math.max(1, length) * wiggle, beam.from.y + dy * t + dx / Math.max(1, length) * wiggle)
    }
    ctx.stroke(); ctx.shadowBlur = 0; ctx.lineWidth *= 0.28; ctx.strokeStyle = '#f4fcff'; ctx.stroke(); ctx.restore()
  }
  const draw = (s: Snapshot, debug: RenderDebug) => {
    lastScene = s
    camera = cameraFor(s)
    ctx.fillStyle = '#050a13'; ctx.fillRect(0, 0, width, height)
    ctx.save(); const zoom = width / camera.width; ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y)
    drawArena(s)
    const objective=s.objective
    if(objective && objective.phase!=='complete'){
      for(const [i,node] of objective.nodes.entries()){
        ring(node.x,node.y,objective.kind==='gate'?75:85,objective.kind==='gate'?CYAN:GOLD,4)
        ctx.textAlign='center';text(objective.kind==='gate'?'靠近选择路线':s.roomCleared?`站立挑战 ${(objective.hold/60).toFixed(1)}/2s`:'清场后可挑战',node.x,node.y-105,19,objective.kind==='gate'?CYAN:GOLD);ctx.textAlign='left'
        void i
      }
      for(const spawn of objective.spawns){ctx.setLineDash([12,10]);ring(spawn.x,spawn.y,spawn.radius+24,GOLD,3);ctx.setLineDash([]);ctx.textAlign='center';text(`${(objective.timer/60).toFixed(1)}s`,spawn.x,spawn.y+5,20,GOLD);ctx.textAlign='left'}
    }
    for(const h of s.hazards??[]){ctx.fillStyle='rgba(255,90,65,0.15)';ctx.beginPath();ctx.arc(h.pos.x,h.pos.y,h.radius,0,Math.PI*2);ctx.fill();ring(h.pos.x,h.pos.y,h.radius,'#ff886c',4)}
    for(const a of s.actors)if(a.alive&&a.supportWarning){const w=a.supportWarning;ctx.setLineDash([10,8]);ring(w.pos.x,w.pos.y,w.kind==='blocker'?130:42,w.kind==='blocker'?'#ff886c':'#c7a1ff',4);ctx.setLineDash([]);ctx.textAlign='center';text(`${w.kind==='blocker'?'封锁':'召援'} ${(w.ticks/60).toFixed(1)}s`,w.pos.x,w.pos.y,19,w.kind==='blocker'?'#ffb0a1':'#ded0ff');ctx.textAlign='left'}
    for (const spawn of s.wave?.spawns ?? []) {
      ctx.setLineDash([12, 10]); ring(spawn.x, spawn.y, spawn.radius + 24 + Math.sin(s.tick * 0.15) * 5, GOLD, 3); ctx.setLineDash([])
      ctx.textAlign = 'center'; text(`${((s.wave?.countdown ?? 0) / 60).toFixed(1)}s`, spawn.x, spawn.y + 5, 21, GOLD); ctx.textAlign = 'left'
    }
    for (const mine of s.mines) {
      ctx.fillStyle = 'rgba(255,207,135,0.035)'; ctx.beginPath(); ctx.arc(mine.x, mine.y, mine.slowRadius, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([10, 16]); ring(mine.x, mine.y, mine.blastRadius, 'rgba(251,209,142,0.18)', 2); ctx.setLineDash([])
      ring(mine.x, mine.y, mine.bodyRadius, mine.nestRole === 'queen' ? '#ed99d0' : mine.child ? '#bda3ff' : mine.fuseTicks !== null ? RED : GOLD, 3)
      if (mine.nestRole) { ctx.setLineDash([5, 7]); ring(mine.x, mine.y, mine.bodyRadius * 0.7, mine.nestRole === 'queen' ? '#d8a3ff' : GOLD, 2); ctx.setLineDash([]) }
      if (mine.pulseCount > 1) text(`${mine.pulsesRemaining}/${mine.pulseCount}`, mine.x + mine.bodyRadius + 6, mine.y + 5, 13, GOLD)
      ctx.fillStyle = mine.grenade ? '#b8c5a5' : GOLD
      ctx.beginPath(); ctx.arc(mine.x, mine.y, 12, 0, Math.PI * 2); ctx.fill()
      if (mine.ignoreBullets) { ctx.setLineDash([3, 4]); ring(mine.x, mine.y, 21, '#9de6bd', 1.5); ctx.setLineDash([]) }
      if (mine.fuseTicks !== null && mine.fuseTotal >= 0.5) {
        ctx.textAlign = 'center'; text(`${(mine.fuseTicks / 60).toFixed(1)}s`, mine.x, mine.y - mine.bodyRadius - 15, 24, '#ffe5b4'); ctx.textAlign = 'left'
      }
    }
    ctx.lineCap = 'round'
    for (const bullet of s.projectiles) drawBullet(bullet)
    for (const beam of s.traces ?? []) drawEnergy(beam, s.tick)
    for (const pickup of s.pickups) {
      const { x, y } = pickup.pos
      const tier = Math.max(0, Math.min(4, Math.log(Math.max(1, pickup.value)) / Math.log(5))), size = 8 + tier * 2
      ctx.shadowBlur = quality==='low'?0:14; ctx.shadowColor = pickup.kind === 'blood' ? '#ffa0b4' : '#8cf0dc'
      ctx.fillStyle = pickup.kind === 'blood' ? '#f48da7' : '#8cf0dc'; ctx.beginPath()
      if (tier > 0) { const sides = 3 + Math.round(tier); for (let i = 0; i < sides; i++) { const angle = i * Math.PI * 2 / sides - Math.PI / 2; if (i === 0) ctx.moveTo(x + Math.cos(angle) * (size + 3), y + Math.sin(angle) * (size + 3)); else ctx.lineTo(x + Math.cos(angle) * (size + 3), y + Math.sin(angle) * (size + 3)) }; ctx.closePath() }
      else if (pickup.kind === 'blood') ctx.arc(x, y, size, 0, Math.PI * 2)
      else { ctx.moveTo(x, y - size - 3); ctx.lineTo(x + size * 0.75, y); ctx.lineTo(x, y + size + 3); ctx.lineTo(x - size * 0.75, y); ctx.closePath() }
      ctx.fill(); ctx.shadowBlur = 0
      if (pickup.kind === 'blood') { ctx.fillStyle = '#fff0f4'; ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillRect(x - 2, y - 6, 4, 12) }
      if (s.coop?.resourceMode==='killer' && pickup.ownerId!==undefined) { const owner=s.coop.members.find(m=>m.id===pickup.ownerId&&m.connected);if(owner)text(owner.name,x-16,y-size-9,10,'#cdb8ef') }
      text(`${pickup.value}${(pickup.quantity ?? 1) > 1 ? '×' + pickup.quantity : ''}`, x - 10, y + size + 18, 12, pickup.kind === 'blood' ? '#ffd8e4' : '#bcfff0')
    }
    for(const a of s.actors)if(a.alive&&a.supportRelayId){const relay=s.actors.find(r=>r.id===a.supportRelayId&&r.alive);if(relay){ctx.save();ctx.strokeStyle='#78e7c9aa';ctx.lineWidth=3;ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(relay.x,relay.y);ctx.lineTo(a.x,a.y);ctx.stroke();ctx.setLineDash([]);ring(a.x,a.y,a.radius+8,'#82eacb',2);ctx.restore()}}
    for (const a of s.actors) if (a.alive) drawActor(a, s.tick)
    for (const effect of quality==='low'?s.effects.slice(-16):s.effects) drawEffect(effect)
    for (const f of quality==='low'?s.floaters.slice(-12):s.floaters) drawFloater(f)
    ctx.restore()
    const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7)
    vignette.addColorStop(0, 'rgba(2,5,12,0)'); vignette.addColorStop(1, 'rgba(2,5,12,0.52)')
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height)
    ctx.save();ctx.translate(safe.left,safe.top)
    drawHud(s, debug)
    drawPractice(debug)
    drawTarget(s)
    ctx.restore()
  }
  return {configure:(settings)=>{quality=settings.quality??'balanced';resize()}, draw, viewToWorld: (x, y, focus) => {
    // Pointer conversion uses this simulation tick's camera, not the previous rendered frame.
    const current = focus && lastScene ? cameraFor(lastScene, focus) : camera
    const rect = canvas.getBoundingClientRect(), zoom = width / current.width
    return { x: current.x + (x - rect.left) / zoom, y: current.y + (y - rect.top) / zoom }
  }, dispose: () => window.removeEventListener('resize', resize) }
}
