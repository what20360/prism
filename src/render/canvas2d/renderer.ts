import type { PracticeState } from '../../app/modes/practice'
import type { EndlessState } from '../../app/modes/endless'
import type { ActorView, EffectView, FloaterView, Snapshot } from '../../core/snapshot'

export interface RenderDebug { readonly fps: number; readonly label?: string; readonly practice?: PracticeState; readonly endless?: EndlessState }
export interface CameraFocus { readonly x: number; readonly y: number; readonly vision: number }
export interface Renderer {
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
  let width = 1, height = 1
  let lastScene: Snapshot | undefined
  let camera: Camera = { x: 0, y: 0, width: 1920, height: 1080 }
  const resize = () => {
    width = canvas.clientWidth || window.innerWidth
    height = canvas.clientHeight || window.innerHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
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
    const player = focus ?? s.actors.find((a) => a.team === 'player')
    const viewWidth = Math.max(1080 * aspect, 1050) * (player?.vision ?? 1)
    const viewHeight = viewWidth / aspect
    const b = s.bounds
    const center = (value: number, start: number, extent: number, view: number) =>
      view >= extent ? start + extent / 2 : clamp(value, start + view / 2, start + extent - view / 2)
    return { x: center(player?.x ?? b.width / 2, b.x, b.width, viewWidth) - viewWidth / 2,
      // Portrait controls occupy the bottom edge; keep the pilot near the clear centre.
      y: width < 700 ? (player?.y ?? b.y + b.height / 2) - viewHeight * 0.46
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
    gradient.addColorStop(0, 'rgba(181,242,255,0.72)')
    gradient.addColorStop(0.35, 'rgba(143,224,255,0.25)')
    gradient.addColorStop(1, 'rgba(143,224,255,0)')
    ctx.strokeStyle = gradient; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(a.x + dx * (a.radius + 16), a.y + dy * (a.radius + 16)); ctx.lineTo(x, y); ctx.stroke()
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.moveTo(a.x - dy * 8, a.y + dx * 8); ctx.lineTo(x, y); ctx.lineTo(a.x + dy * 8, a.y - dx * 8); ctx.fill()
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
    if (player) drawAim(a)
    if (a.deflectFieldRadius > 0) {
      const glow = ctx.createRadialGradient(a.x, a.y, r, a.x, a.y, a.deflectFieldRadius)
      glow.addColorStop(0, a.deflectActive ? 'rgba(174,146,255,0.16)' : 'rgba(115,203,245,0.035)'); glow.addColorStop(1, 'rgba(100,190,255,0)')
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(a.x, a.y, a.deflectFieldRadius, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([12, 25]); ring(a.x, a.y, a.deflectFieldRadius, a.deflectActive ? '#b99bff' : 'rgba(155,208,255,0.16)', a.deflectActive ? 4 : 2); ctx.setLineDash([])
    }
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(player ? a.aimAngle : a.behavior === 'boss' ? tick * 0.003 : 0)
    ctx.beginPath()
    if (player) {
      ctx.moveTo(r, 0); ctx.lineTo(r * 0.1, r * 0.7); ctx.lineTo(-r * 0.65, r * 0.52)
      ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.65, -r * 0.52); ctx.lineTo(r * 0.1, -r * 0.7); ctx.closePath()
    } else {
      const count = a.behavior === 'boss' ? 6 : a.behavior === 'turret' ? 3 : 4
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count - Math.PI / 2
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      ctx.closePath()
    }
    const color = player ? a.enraged ? GOLD : CYAN : a.behavior === 'boss' ? PURPLE : RED
    ctx.shadowColor = color; ctx.shadowBlur = player ? 16 : 9
    ctx.fillStyle = player ? '#18394b' : '#341c32'; ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0
    if (a.coreRadius > 0) {
      ctx.fillStyle = player ? 'rgba(207,248,255,0.15)' : 'rgba(255,197,213,0.15)'
      ctx.beginPath(); ctx.arc(0, 0, a.coreRadius, 0, Math.PI * 2); ctx.fill()
      ring(0, 0, a.coreRadius, player ? '#c9f6ff' : '#ffd1dc', 1.5)
      ctx.fillStyle = player ? '#effcff' : '#ffe0ea'; ctx.beginPath(); ctx.arc(0, 0, Math.min(6, a.coreRadius * 0.4), 0, Math.PI * 2); ctx.fill()
    } else { ctx.fillStyle = color; ctx.fillRect(-4, -4, 8, 8) }
    ctx.restore()
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
    if (!player && (a.hp < a.maxHp || a.damageFlashTicks > 0)) {
      const ratio = clamp(a.hp / a.maxHp, 0, 1)
      ctx.fillStyle = '#09101b'; ctx.fillRect(a.x - r, a.y - r - 20, r * 2, 5)
      ctx.fillStyle = color; ctx.fillRect(a.x - r, a.y - r - 20, r * 2 * ratio, 5)
      if (a.damageFlashTicks > 0) {
        ctx.textAlign = 'center'
        text(a.name ?? '敌人', a.x, a.y - r - 54, 18, '#e3c7d9')
        text(`${Math.ceil(a.hp)} / ${Math.round(a.maxHp)}  护甲 ${Math.round(a.armor)}`, a.x, a.y - r - 32, 14, '#aebed0')
        ctx.textAlign = 'left'
      }
    }
  }
  const drawEffect = (e: EffectView) => {
    const alpha = clamp(e.ttl / 18, 0, 1), progress = 1 - alpha
    const color = e.kind === 'explosion' ? GOLD : e.kind === 'coreHit' || e.kind === 'reflect' ? PURPLE : e.kind === 'death' ? RED : CYAN
    ctx.globalAlpha = alpha
    ring(e.x, e.y, e.radius * (0.3 + progress), color, Math.max(1, 5 * alpha))
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399, radius = e.radius * progress
      ctx.fillStyle = color; ctx.fillRect(e.x + Math.cos(angle) * radius, e.y + Math.sin(angle) * radius, 4 * alpha + 1, 4 * alpha + 1)
    }
    ctx.globalAlpha = 1
  }
  const drawFloater = (f: FloaterView) => {
    ctx.globalAlpha = Math.min(1, f.ttl / 20); ctx.textAlign = 'center'
    const value = Math.round(f.value * 10) / 10
    const label = f.kind === 'shard' ? `◆ ${value}` : f.kind === 'overflow' ? `溢 ${Math.round(value)}` : f.kind === 'taken' ? `−${Math.round(value)}` : f.kind === 'heal' ? `+${Math.round(value)}` : `${Math.round(value)}`
    const color = f.kind === 'shard' ? '#91eacb' : f.kind === 'overflow' ? GOLD : f.kind === 'taken' ? RED : f.kind === 'heal' ? '#9ff4c3' : '#e7f5ff'
    ctx.shadowColor = '#02050c'; ctx.shadowBlur = 5; text(label, f.x, f.y, f.kind === 'shard' ? 19 : 25, color)
    ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.globalAlpha = 1
  }
  const drawHud = (s: Snapshot, debug: RenderDebug) => {
    const phone = width < 700, p = s.actors.find((a) => a.team === 'player')
    text('P R I S M', 20, 29, 15, CYAN)
    text(`${debug.label ?? ''}  /  ${debug.endless ? debug.endless.open ? '开放层' : '清场层' : debug.practice ? debug.practice.config.scenario === 'targets' ? '固定靶机' : '敌人演练' : s.roomKind === 'safe' ? '安全区' : s.roomKind === 'boss' ? '核心决战' : '探索中'}`, 20, 49, 11, '#6f90ac')
    if (p) {
      const barWidth = phone ? 142 : 210
      ctx.fillStyle = '#192538'; ctx.fillRect(20, 65, barWidth, 5)
      ctx.fillStyle = p.hp < p.maxHp * 0.3 ? RED : CYAN; ctx.fillRect(20, 65, barWidth * clamp(p.hp / p.maxHp, 0, 1), 5)
      text(`${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}${p.shield > 0 ? `  ◇${Math.ceil(p.shield)}` : ''}`, 20, 90, 12, '#d6e6f3')
      text(debug.practice ? `${debug.practice.config.invincible ? '无敌开启' : '可受伤'} · ${debug.practice.config.freeCards ? '自由购卡' : '限额购卡'}` : `◆ ${Math.floor(s.shards)}   击破 ${s.stats.kills}`, 20, 111, 12, GOLD)
      if (debug.endless) {
        text(`种子 ${debug.endless.seed} · 敌人 ${debug.endless.alive + debug.endless.pending}`, 20, 133, 11, PURPLE)
        if (!phone) text(debug.endless.open ? `传送门开放 · 下次补刷收益 ${Number((debug.endless.nextReward * 100).toFixed(1))}%` : '清空敌人，开启下一层', 20, 153, 11, '#8ad9bb')
      } else if (s.stats.chain > 1 && !debug.practice) text(`连击 ×${s.stats.chain}`, 20, 133, 12, PURPLE)
      if (!phone) {
        text(p.autoFire ? '扳机模组已装备' : '按住左键射击 · 右键目标锁定 · 右键空白取消', 20, height - 25, 12, '#7591a9')
        for (const [i, skill] of p.skills.entries()) if (skill.id) {
          const name = skill.id === 'deflect' ? '偏转' : skill.id === 'rage' ? '狂暴' : '冲刺'
          text(`${i === 0 ? 'J' : 'K'}  ${name}  ${skill.active ? '生效中' : skill.cooldown > 0 ? skill.cooldown.toFixed(1) + 's' : '就绪'}`, width / 2 - 115 + i * 170, height - 25, 12, PURPLE)
        }
      }
    }
    const mw = phone ? 100 : 180, mh = mw * s.bounds.height / s.bounds.width, mx = width - mw - 18, my = 66
    ctx.fillStyle = 'rgba(3,8,17,0.8)'; ctx.fillRect(mx, my, mw, mh)
    ctx.strokeStyle = '#29425d'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh)
    const sx = mw / s.bounds.width, sy = mh / s.bounds.height
    ctx.fillStyle = '#334a65'
    for (const wall of s.walls) ctx.fillRect(mx + wall.x * sx, my + wall.y * sy, wall.width * sx, wall.height * sy)
    for (const a of s.actors) {
      if (!a.alive) continue
      ctx.fillStyle = a.team === 'player' ? CYAN : RED; ctx.fillRect(mx + a.x * sx - 2, my + a.y * sy - 2, 4, 4)
    }
    if (s.exit) { ctx.fillStyle = '#97e5c2'; ctx.fillRect(mx + s.exit.x * sx, my + s.exit.y * sy, Math.max(4, s.exit.width * sx), Math.max(3, s.exit.height * sy)) }
    ctx.textAlign = 'center'
    if (s.awaitsEntry) text('向前移动，进入战斗区域', width / 2, phone ? height * 0.42 : height - 58, phone ? 12 : 14, '#afc6d9')
    else if (s.roomCleared) text('区域已净空 · 前往传送门', width / 2, phone ? height * 0.43 : height - 58, phone ? 12 : 14, '#8ad9bb')
    ctx.textAlign = 'left'
  }
  const drawPractice = (debug: RenderDebug) => {
    const state = debug.practice
    if (!state) return
    if (width < 700) { text(`伤害 ${Number(state.damage.toFixed(1))} · DPS ${state.recentDps.toFixed(1)}`, 20, 133, 11, CYAN); return }
    ctx.fillStyle = 'rgba(5,14,25,0.88)'; ctx.fillRect(18, 150, 205, 100)
    ctx.strokeStyle = '#294f60'; ctx.lineWidth = 1; ctx.strokeRect(18, 150, 205, 100)
    text(`总伤害  ${state.damage.toFixed(1)}`, 30, 174, 12, CYAN)
    text(`近3秒DPS  ${state.recentDps.toFixed(1)}`, 30, 201, 12, '#cadbe6')
    text(`平均DPS  ${state.averageDps.toFixed(1)}`, 30, 228, 12, '#90a9bb')
  }
  const drawTarget = (s: Snapshot) => {
    const target = s.actors.find((a) => a.locked && a.alive)
    if (!target) return
    const phone = width < 700, w = phone ? 190 : 220, x = phone ? 20 : width - w - 18, y = phone ? 150 : 190
    const h = target.rewardMultiplier < 1 ? 134 : 113
    ctx.fillStyle = 'rgba(5,14,25,0.92)'; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = target.manualLocked ? '#9c8354' : '#37687d'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h)
    text(`${target.manualLocked ? '◆' : '◇'} ${target.name ?? '目标'} · ${target.manualLocked ? '手动锁定' : '方向锁定'}`, x + 10, y + 19, 11, target.manualLocked ? GOLD : CYAN)
    ctx.fillStyle = '#253244'; ctx.fillRect(x + 10, y + 29, w - 20, 3)
    ctx.fillStyle = RED; ctx.fillRect(x + 10, y + 29, (w - 20) * clamp(target.hp / target.maxHp, 0, 1), 3)
    text(`生命 ${Math.ceil(target.hp)} / ${Math.round(target.maxHp)}   盾 ${Math.ceil(target.shield)}`, x + 10, y + 49, 11)
    text(`护甲 ${Math.round(target.armor)}   移速 ${Math.round(target.movementSpeed)}`, x + 10, y + 70, 11)
    text(`伤害 ${Number(target.damage.toFixed(1))}   攻速 ${Number(target.fireRate.toFixed(2))}/s`, x + 10, y + 91, 11)
    if (target.rewardMultiplier < 1) text(`棱晶收益 ${Number((target.rewardMultiplier * 100).toFixed(2))}%`, x + 10, y + 112, 11, GOLD)
  }
  const drawBullet = (bullet: Snapshot['projectiles'][number]) => {
    const energy = bullet.rangeRatio
    const hue = bullet.team === 'player' ? 245 - 55 * energy : (382 - 32 * energy) % 360
    const color = `hsl(${hue}, 90%, ${38 + 42 * energy}%)`
    const halo = `hsla(${hue}, 95%, ${48 + 24 * energy}%, ${0.06 + 0.3 * energy})`
    ctx.save(); ctx.globalAlpha = 0.65 + 0.35 * energy
    const count = Math.min(bullet.trail.length, Math.ceil(bullet.speed / 160))
    const trail = bullet.trail.slice(-count)
    if (count > 0 && bullet.speed > 35) {
      const first = trail[0]!, fade = ctx.createLinearGradient(first.x, first.y, bullet.x + 0.01, bullet.y + 0.01)
      fade.addColorStop(0, `hsla(${hue}, 90%, 55%, 0)`); fade.addColorStop(1, color)
      ctx.strokeStyle = fade; ctx.lineWidth = Math.max(2, bullet.radius * 0.65)
      ctx.beginPath(); ctx.moveTo(first.x, first.y)
      for (const point of trail) ctx.lineTo(point.x, point.y)
      ctx.lineTo(bullet.x, bullet.y); ctx.stroke()
    }
    const glow = ctx.createRadialGradient(bullet.x, bullet.y, 0, bullet.x, bullet.y, bullet.radius * 2.2)
    glow.addColorStop(0, halo); glow.addColorStop(1, `hsla(${hue}, 95%, 50%, 0)`)
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius * 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius * 0.72, 0, Math.PI * 2); ctx.fill()
    ring(bullet.x, bullet.y, bullet.radius, color, 1.2)
    ctx.fillStyle = `hsl(${hue}, 90%, ${60 + 38 * energy}%)`; ctx.beginPath(); ctx.arc(bullet.x - bullet.radius * 0.17, bullet.y - bullet.radius * 0.17, Math.max(2, bullet.radius * 0.29), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  const draw = (s: Snapshot, debug: RenderDebug) => {
    lastScene = s
    camera = cameraFor(s)
    ctx.fillStyle = '#050a13'; ctx.fillRect(0, 0, width, height)
    ctx.save(); const zoom = width / camera.width; ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y)
    drawArena(s)
    for (const mine of s.mines) {
      ctx.fillStyle = 'rgba(255,207,135,0.035)'; ctx.beginPath(); ctx.arc(mine.x, mine.y, mine.slowRadius, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([10, 16]); ring(mine.x, mine.y, mine.blastRadius, 'rgba(251,209,142,0.18)', 2); ctx.setLineDash([])
      ring(mine.x, mine.y, mine.bodyRadius, mine.fuseTicks !== null ? RED : GOLD, 3)
      ctx.fillStyle = mine.grenade ? '#b8c5a5' : GOLD
      ctx.beginPath(); ctx.arc(mine.x, mine.y, 12, 0, Math.PI * 2); ctx.fill()
      if (mine.ignoreBullets) { ctx.setLineDash([3, 4]); ring(mine.x, mine.y, 21, '#9de6bd', 1.5); ctx.setLineDash([]) }
      if (mine.fuseTicks !== null && mine.fuseTotal >= 0.5) {
        ctx.textAlign = 'center'; text(`${(mine.fuseTicks / 60).toFixed(1)}s`, mine.x, mine.y - mine.bodyRadius - 15, 24, '#ffe5b4'); ctx.textAlign = 'left'
      }
    }
    ctx.lineCap = 'round'
    for (const bullet of s.projectiles) drawBullet(bullet)
    for (const pickup of s.pickups) {
      const { x, y } = pickup.pos
      ctx.shadowBlur = 14; ctx.shadowColor = pickup.kind === 'blood' ? '#ffa0b4' : '#8cf0dc'
      ctx.fillStyle = pickup.kind === 'blood' ? '#f48da7' : '#8cf0dc'; ctx.beginPath()
      if (pickup.kind === 'blood') ctx.arc(x, y, 12, 0, Math.PI * 2)
      else { ctx.moveTo(x, y - 15); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 15); ctx.lineTo(x - 10, y); ctx.closePath() }
      ctx.fill(); ctx.shadowBlur = 0
      if (pickup.kind === 'blood') { ctx.fillStyle = '#fff0f4'; ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillRect(x - 2, y - 6, 4, 12) }
    }
    for (const a of s.actors) if (a.alive) drawActor(a, s.tick)
    for (const effect of s.effects) drawEffect(effect)
    for (const f of s.floaters) drawFloater(f)
    ctx.restore()
    const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7)
    vignette.addColorStop(0, 'rgba(2,5,12,0)'); vignette.addColorStop(1, 'rgba(2,5,12,0.52)')
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height)
    drawHud(s, debug)
    drawPractice(debug)
    drawTarget(s)
  }
  return { draw, viewToWorld: (x, y, focus) => {
    // Pointer conversion uses this simulation tick's camera, not the previous rendered frame.
    const current = focus && lastScene ? cameraFor(lastScene, focus) : camera
    const rect = canvas.getBoundingClientRect(), zoom = width / current.width
    return { x: current.x + (x - rect.left) / zoom, y: current.y + (y - rect.top) / zoom }
  }, dispose: () => window.removeEventListener('resize', resize) }
}
