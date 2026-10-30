import type {
  ActorView,
  EffectView,
  FloaterView,
  MineView,
  ProjectileView,
  Snapshot,
} from '../../core/snapshot'
import type { Rect } from '../../core/types'
import { COLORS } from './theme'

export interface RenderDebug {
  readonly fps: number
  /** Dungeon label such as F2-3; supplied by the app. */
  readonly label?: string
}

export interface Renderer {
  draw(snapshot: Snapshot, debug: RenderDebug): void
  /** Converts a viewport (CSS) point into world space using the last camera. */
  viewToWorld(clientX: number, clientY: number): { x: number; y: number }
  dispose(): void
}

const GRID_SIZE = 256
/** World units visible vertically; the horizontal span follows the aspect ratio. */
const VIEW_HEIGHT = 1080

interface Camera {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function createCanvasRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas2D context is unavailable')

  let viewportWidth = 1
  let viewportHeight = 1
  /** Camera of the last frame, so pointer coordinates can be converted. */
  let lastCamera: Camera | null = null

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1
    viewportWidth = canvas.clientWidth || window.innerWidth
    viewportHeight = canvas.clientHeight || window.innerHeight
    canvas.width = Math.round(viewportWidth * dpr)
    canvas.height = Math.round(viewportHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  window.addEventListener('resize', resize)
  resize()

  const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value

  /** Camera follows the player and is clamped inside the arena. */
  const computeCamera = (snapshot: Snapshot, aspect: number): Camera => {
    const viewWidth = VIEW_HEIGHT * aspect
    const viewHeight = VIEW_HEIGHT
    const { bounds } = snapshot
    const player = snapshot.actors.find((actor) => actor.team === 'player')

    let centerX = player ? player.x : bounds.x + bounds.width / 2
    let centerY = player ? player.y : bounds.y + bounds.height / 2

    centerX =
      viewWidth >= bounds.width
        ? bounds.x + bounds.width / 2
        : clamp(centerX, bounds.x + viewWidth / 2, bounds.x + bounds.width - viewWidth / 2)
    centerY =
      viewHeight >= bounds.height
        ? bounds.y + bounds.height / 2
        : clamp(centerY, bounds.y + viewHeight / 2, bounds.y + bounds.height - viewHeight / 2)

    return {
      x: centerX - viewWidth / 2,
      y: centerY - viewHeight / 2,
      width: viewWidth,
      height: viewHeight,
    }
  }

  const drawGrid = (camera: Camera): void => {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 2
    ctx.beginPath()

    const startX = Math.floor(camera.x / GRID_SIZE) * GRID_SIZE
    const endX = camera.x + camera.width
    for (let x = startX; x <= endX; x += GRID_SIZE) {
      ctx.moveTo(x, camera.y)
      ctx.lineTo(x, camera.y + camera.height)
    }

    const startY = Math.floor(camera.y / GRID_SIZE) * GRID_SIZE
    const endY = camera.y + camera.height
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      ctx.moveTo(camera.x, y)
      ctx.lineTo(camera.x + camera.width, y)
    }

    ctx.stroke()
  }

  const drawRoom = (bounds: Rect, walls: readonly Rect[]): void => {
    // Boundary band: a thick outer stroke plus a thin inner one so the room
    // edge reads as a wall instead of a hairline.
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.9)'
    ctx.lineWidth = 16
    ctx.strokeRect(bounds.x + 8, bounds.y + 8, bounds.width - 16, bounds.height - 16)
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.45)'
    ctx.lineWidth = 3
    ctx.strokeRect(bounds.x + 22, bounds.y + 22, bounds.width - 44, bounds.height - 44)

    for (const wall of walls) {
      ctx.fillStyle = COLORS.wallFill
      ctx.strokeStyle = COLORS.wallStroke
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height)
      ctx.strokeRect(wall.x + 1, wall.y + 1, wall.width - 2, wall.height - 2)
    }
  }

  /** Dashed guide from the player to the exit so the way forward is obvious. */
  const drawGuide = (player: ActorView, exit: Rect): void => {
    const targetX = exit.x + exit.width / 2
    const targetY = exit.y + exit.height / 2

    ctx.beginPath()
    ctx.setLineDash([40, 26])
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)'
    ctx.lineWidth = 6
    ctx.moveTo(player.x, player.y)
    ctx.lineTo(targetX, targetY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const drawExit = (exit: Rect): void => {
    ctx.fillStyle = 'rgba(255, 209, 102, 0.16)'
    ctx.fillRect(exit.x, exit.y, exit.width, exit.height)
    ctx.strokeStyle = COLORS.mineArmed
    ctx.lineWidth = 4
    ctx.setLineDash([16, 10])
    ctx.strokeRect(exit.x, exit.y, exit.width, exit.height)
    ctx.setLineDash([])

    ctx.fillStyle = COLORS.mineArmed
    ctx.font = '28px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText('EXIT', exit.x + exit.width / 2, exit.y + exit.height / 2 + 10)
    ctx.textAlign = 'left'
  }

  const drawMine = (mine: MineView): void => {
    const color = mine.team === 'player' ? COLORS.mineOwn : COLORS.mineEnemy

    ctx.beginPath()
    ctx.arc(mine.x, mine.y, mine.slowRadius, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.mineField
    ctx.fill()

    ctx.beginPath()
    ctx.setLineDash([18, 14])
    ctx.arc(mine.x, mine.y, mine.blastRadius, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.mineBlast
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.setLineDash([])

    const armed = mine.fuseTicks !== null
    ctx.beginPath()
    ctx.arc(mine.x, mine.y, mine.bodyRadius, 0, Math.PI * 2)
    ctx.fillStyle = armed ? COLORS.mineArmed : color
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.stroke()
  }

  const drawProjectile = (projectile: ProjectileView): void => {
    ctx.beginPath()
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2)
    ctx.fillStyle = projectile.team === 'player' ? COLORS.playerBullet : COLORS.enemyBullet
    ctx.fill()
  }

  const drawActor = (actor: ActorView): void => {
    const isPlayer = actor.team === 'player'
    const fill = isPlayer ? COLORS.playerFill : COLORS.enemyFill
    const stroke = isPlayer ? COLORS.playerStroke : COLORS.enemyStroke
    const r = actor.radius

    ctx.beginPath()
    if (isPlayer) {
      ctx.arc(actor.x, actor.y, r, 0, Math.PI * 2)
    } else if (actor.behavior === 'turret') {
      ctx.moveTo(actor.x, actor.y - r)
      ctx.lineTo(actor.x + r * 0.92, actor.y + r * 0.78)
      ctx.lineTo(actor.x - r * 0.92, actor.y + r * 0.78)
      ctx.closePath()
    } else {
      ctx.moveTo(actor.x, actor.y - r)
      ctx.lineTo(actor.x + r, actor.y)
      ctx.lineTo(actor.x, actor.y + r)
      ctx.lineTo(actor.x - r, actor.y)
      ctx.closePath()
    }
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = stroke
    ctx.stroke()

    if (actor.coreRadius > 0) {
      ctx.beginPath()
      ctx.arc(actor.x, actor.y, actor.coreRadius, 0, Math.PI * 2)
      ctx.fillStyle = isPlayer ? COLORS.playerCore : COLORS.enemyCore
      ctx.fill()
    }

    if (actor.shield > 0) {
      ctx.beginPath()
      ctx.arc(actor.x, actor.y, r + 12, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.6)'
      ctx.lineWidth = 4
      ctx.stroke()
    }

    if (actor.deflectFieldRadius > 0) {
      ctx.beginPath()
      ctx.arc(actor.x, actor.y, actor.deflectFieldRadius, 0, Math.PI * 2)
      ctx.strokeStyle = actor.deflectActive ? 'rgba(255, 209, 102, 0.55)' : 'rgba(138, 245, 255, 0.22)'
      ctx.lineWidth = actor.deflectActive ? 5 : 3
      ctx.setLineDash([26, 18])
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (actor.deflectActive) {
      ctx.beginPath()
      ctx.arc(actor.x, actor.y, r + 22, 0, Math.PI * 2)
      ctx.strokeStyle = actor.deflectLevel >= 2 ? '#ffd166' : '#8af5ff'
      ctx.lineWidth = 5
      ctx.setLineDash([18, 12])
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (actor.hp < actor.maxHp) {
      const width = r * 2.6
      const ratio = Math.max(0, actor.hp / actor.maxHp)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(actor.x - width / 2, actor.y - r - 26, width, 9)
      ctx.fillStyle = stroke
      ctx.fillRect(actor.x - width / 2, actor.y - r - 26, width * ratio, 9)
    }
  }

  const drawEffect = (effect: EffectView): void => {
    const progress = 1 - effect.ttl / 18
    const alpha = Math.max(0, effect.ttl / 18)

    let color: string = COLORS.fxHit
    if (effect.kind === 'coreHit') color = COLORS.fxCore
    else if (effect.kind === 'explosion') color = COLORS.fxExplosion
    else if (effect.kind === 'death') color = COLORS.fxDeath
    else if (effect.kind === 'reflect') color = COLORS.fxCore
    else if (effect.kind === 'deflect') color = COLORS.playerBullet
    else if (effect.kind === 'revive') color = COLORS.mineArmed

    ctx.beginPath()
    ctx.arc(effect.x, effect.y, effect.radius * (0.4 + progress * 0.8), 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const MINIMAP_WIDTH = 220

  /** Screen-space overview: room, walls, exit, enemies, player and the camera window. */
  const drawMinimap = (snapshot: Snapshot, camera: Camera): void => {
    const { bounds } = snapshot
    const width = MINIMAP_WIDTH
    const height = (width * bounds.height) / bounds.width
    const x = viewportWidth - width - 24
    const y = 52
    const sx = width / bounds.width
    const sy = height / bounds.height

    ctx.fillStyle = 'rgba(4, 6, 12, 0.75)'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x, y, width, height)

    ctx.strokeStyle = 'rgba(120, 170, 255, 0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + camera.x * sx, y + camera.y * sy, camera.width * sx, camera.height * sy)

    ctx.fillStyle = 'rgba(120, 170, 255, 0.4)'
    for (const wall of snapshot.walls) {
      ctx.fillRect(x + wall.x * sx, y + wall.y * sy, wall.width * sx, wall.height * sy)
    }

    if (snapshot.exit) {
      ctx.fillStyle = COLORS.mineArmed
      ctx.fillRect(x + snapshot.exit.x * sx, y + snapshot.exit.y * sy, snapshot.exit.width * sx, snapshot.exit.height * sy)
    }

    ctx.fillStyle = COLORS.enemyStroke
    for (const actor of snapshot.actors) {
      if (!actor.alive || actor.team !== 'enemy') continue
      const r = Math.max(2, actor.radius * sx)
      ctx.fillRect(x + actor.x * sx - r, y + actor.y * sy - r, r * 2, r * 2)
    }

    const player = snapshot.actors.find((actor) => actor.team === 'player')
    if (player) {
      ctx.beginPath()
      ctx.arc(x + player.x * sx, y + player.y * sy, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.playerStroke
      ctx.fill()
    }
  }

  const drawHud = (snapshot: Snapshot, debug: RenderDebug, camera: Camera): void => {
    const player = snapshot.actors.find((actor) => actor.team === 'player')

    ctx.font = '18px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.hudText
    ctx.fillText(`tick ${snapshot.tick}   fps ${debug.fps.toFixed(0)}`, 24, 20)
    if (debug.label) {
      ctx.fillStyle = COLORS.hudAccent
      ctx.fillText(`${debug.label}  ${snapshot.roomKind.toUpperCase()}`, viewportWidth - 260, 20)
    }

    drawMinimap(snapshot, camera)

    if (snapshot.awaitsEntry && !snapshot.gameOver) {
      ctx.textAlign = 'center'
      ctx.fillStyle = COLORS.hudWarn
      ctx.fillText('走进房间开始战斗 · STEP IN TO ENGAGE', viewportWidth / 2, viewportHeight - 100)
      ctx.textAlign = 'left'
    }

    if (!player) return

    ctx.fillStyle = COLORS.hudAccent
    ctx.fillText(`HP ${Math.ceil(player.hp)}/${player.maxHp}`, 24, 52)

    let line = 80
    if (player.shield > 0) {
      ctx.fillStyle = COLORS.hudText
      ctx.fillText(`SHIELD ${Math.ceil(player.shield)}`, 24, line)
      line += 28
    }

    ctx.fillStyle = COLORS.hudText
    ctx.fillText(`SHARDS ${Math.floor(snapshot.shards)}`, 24, line)
    line += 28
    ctx.fillText(`KILLS ${snapshot.stats.kills}   CORE ${snapshot.stats.coreHits}`, 24, line)
    line += 28

    if (snapshot.stats.chain > 1) {
      ctx.fillStyle = COLORS.hudWarn
      ctx.fillText(`CHAIN x${snapshot.stats.chain}`, 24, line)
      line += 28
    }

    if (player.deflectFieldRadius > 0) {
      ctx.fillStyle = player.deflectActive ? COLORS.hudWarn : COLORS.hudText
      ctx.fillText(`FIELD ${player.deflectFieldRadius}`, 24, line)
      line += 28
    }

    if (player.deflectLevel > 0) {
      const state = player.deflectActive ? 'ACTIVE' : player.deflectReady ? 'READY' : 'COOLDOWN'
      ctx.fillStyle = player.deflectActive ? COLORS.hudWarn : COLORS.hudText
      const suffix =
        player.deflectReady || player.deflectActive
          ? ''
          : ` ${player.deflectCooldownSeconds.toFixed(1)}s`
      ctx.fillText(`SKILL ${state}${suffix}`, 24, line)

      // Cooldown gauge: full bar means the skill is ready again.
      const barWidth = 120
      const barY = line + 24
      const ratio =
        player.deflectReady || player.deflectActive
          ? 1
          : 1 - player.deflectCooldownSeconds / Math.max(0.001, player.deflectCooldownTotal)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(24, barY, barWidth, 6)
      ctx.fillStyle = player.deflectActive ? COLORS.hudWarn : COLORS.hudAccent
      ctx.fillRect(24, barY, barWidth * Math.max(0, Math.min(1, ratio)), 6)
    }

    if (snapshot.roomCleared && !snapshot.gameOver) {
      ctx.fillStyle = COLORS.hudWarn
      ctx.fillText('ROOM CLEAR', viewportWidth - 160, 20)
    }
  }

  const drawEndScreen = (victory: boolean): void => {
    ctx.fillStyle = COLORS.overlay
    ctx.fillRect(0, 0, viewportWidth, viewportHeight)

    ctx.textAlign = 'center'
    ctx.fillStyle = victory ? COLORS.mineArmed : COLORS.enemyStroke
    ctx.font = '56px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(victory ? 'VICTORY' : 'GAME OVER', viewportWidth / 2, viewportHeight / 2 - 24)

    ctx.fillStyle = COLORS.hudText
    ctx.font = '20px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('按 R 重新开始', viewportWidth / 2, viewportHeight / 2 + 34)
    ctx.textAlign = 'left'
  }

  const drawFloater = (floater: FloaterView): void => {
    const alpha = Math.min(1, floater.ttl / 26)
    let color: string = COLORS.hudText
    let size = 24
    let label = String(Math.round(floater.value))

    if (floater.kind === 'damage') {
      color = '#ffffff'
    } else if (floater.kind === 'overflow') {
      color = COLORS.mineArmed
      size = 26
      label = `溢 ${label}`
    } else if (floater.kind === 'taken') {
      color = COLORS.enemyStroke
      size = 28
      label = `-${label}`
    } else if (floater.kind === 'shard') {
      color = COLORS.hudAccent
      size = 20
      label = `◆${Math.round(floater.value * 10) / 10}`
    } else if (floater.kind === 'heal') {
      color = '#7dffa8'
      size = 24
      label = `+${label}`
    }

    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    // A thin dark outline keeps the numbers readable over bullets and walls.
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(3, 5, 10, 0.85)'
    ctx.strokeText(label, floater.x, floater.y)
    ctx.fillText(label, floater.x, floater.y)
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1
  }

  /** Name + hp + armor card above an enemy that was just hit. */
  const drawTargetCard = (actor: ActorView): void => {
    const name = actor.name ?? actor.tier.toUpperCase()
    const text = `${name}  ${Math.ceil(actor.hp)}/${Math.round(actor.maxHp)}  甲 ${Math.round(actor.armor)}`
    const y = actor.y - actor.radius - 76

    ctx.font = '20px ui-monospace, SFMono-Regular, Menlo, monospace'
    const width = ctx.measureText(text).width + 20
    ctx.fillStyle = 'rgba(4, 6, 12, 0.7)'
    ctx.fillRect(actor.x - width / 2, y - 18, width, 26)
    ctx.fillStyle = COLORS.hudText
    ctx.textAlign = 'center'
    ctx.fillText(text, actor.x, y)
    ctx.textAlign = 'left'
  }

  /** Aim line plus a streak along the current movement direction. */
  const drawPlayerIndicators = (player: ActorView): void => {
    const length = 150
    const tipX = player.x + Math.cos(player.aimAngle) * length
    const tipY = player.y + Math.sin(player.aimAngle) * length

    ctx.beginPath()
    ctx.moveTo(player.x + Math.cos(player.aimAngle) * player.radius, player.y + Math.sin(player.aimAngle) * player.radius)
    ctx.lineTo(tipX, tipY)
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.5)'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(tipX, tipY, 5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(90, 220, 255, 0.7)'
    ctx.fill()

    const moveLength = Math.hypot(player.moveX, player.moveY)
    if (moveLength < 0.1) return

    const backX = player.x - (player.moveX / moveLength) * (player.radius + 18)
    const backY = player.y - (player.moveY / moveLength) * (player.radius + 18)
    ctx.beginPath()
    ctx.moveTo(player.x - (player.moveX / moveLength) * player.radius, player.y - (player.moveY / moveLength) * player.radius)
    ctx.lineTo(backX, backY)
    ctx.strokeStyle = 'rgba(159, 179, 209, 0.45)'
    ctx.lineWidth = 6
    ctx.stroke()
  }

  const draw = (snapshot: Snapshot, debug: RenderDebug): void => {
    const aspect = viewportWidth / viewportHeight
    const camera = computeCamera(snapshot, aspect)
    const scale = viewportWidth / camera.width
    lastCamera = camera

    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, viewportWidth, viewportHeight)

    ctx.save()
    ctx.scale(scale, scale)
    ctx.translate(-camera.x, -camera.y)

    drawGrid(camera)
    drawRoom(snapshot.bounds, snapshot.walls)
    if (snapshot.exit) {
      drawExit(snapshot.exit)
      const player = snapshot.actors.find((actor) => actor.team === 'player')
      if (player) drawGuide(player, snapshot.exit)
    }
    for (const mine of snapshot.mines) drawMine(mine)
    for (const projectile of snapshot.projectiles) drawProjectile(projectile)
    for (const actor of snapshot.actors) {
      if (!actor.alive) continue
      drawActor(actor)
      if (actor.team === 'player') drawPlayerIndicators(actor)
      else if (actor.damageFlashTicks > 0) drawTargetCard(actor)
    }
    for (const effect of snapshot.effects) drawEffect(effect)
    for (const floater of snapshot.floaters) drawFloater(floater)

    ctx.restore()

    drawHud(snapshot, debug, camera)
    if (snapshot.gameOver || snapshot.victory) drawEndScreen(snapshot.victory)
  }

  const dispose = (): void => {
    window.removeEventListener('resize', resize)
  }

  const viewToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const camera = lastCamera
    if (!camera) return { x: clientX, y: clientY }
    const rect = canvas.getBoundingClientRect()
    const scale = viewportWidth / camera.width
    return {
      x: camera.x + (clientX - rect.left) / scale,
      y: camera.y + (clientY - rect.top) / scale,
    }
  }

  return { draw, viewToWorld, dispose }
}