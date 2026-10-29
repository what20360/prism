import type { ActorView, EffectView, MineView, ProjectileView, Snapshot } from '../../core/snapshot'
import type { Rect } from '../../core/types'
import { COLORS } from './theme'

export interface RenderDebug {
  readonly fps: number
}

export interface Renderer {
  draw(snapshot: Snapshot, debug: RenderDebug): void
  dispose(): void
}

const GRID_SIZE = 128

export function createCanvasRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas2D context is unavailable')

  let viewportWidth = 1
  let viewportHeight = 1

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

  const drawGrid = (bounds: Rect): void => {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += GRID_SIZE) {
      ctx.moveTo(x, bounds.y)
      ctx.lineTo(x, bounds.y + bounds.height)
    }
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += GRID_SIZE) {
      ctx.moveTo(bounds.x, y)
      ctx.lineTo(bounds.x + bounds.width, y)
    }
    ctx.stroke()
  }

  const drawRoom = (bounds: Rect, walls: readonly Rect[]): void => {
    ctx.lineWidth = 2
    ctx.strokeStyle = COLORS.roomBorder
    ctx.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width - 1, bounds.height - 1)

    for (const wall of walls) {
      ctx.fillStyle = COLORS.wallFill
      ctx.strokeStyle = COLORS.wallStroke
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height)
      ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.width - 1, wall.height - 1)
    }
  }

  const drawMine = (mine: MineView): void => {
    const color = mine.team === 'player' ? COLORS.mineOwn : COLORS.mineEnemy

    // Slow field and blast radius must always be visible (requirements 5.6.2).
    ctx.beginPath()
    ctx.arc(mine.x, mine.y, mine.slowRadius, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.mineField
    ctx.fill()

    ctx.beginPath()
    ctx.setLineDash([8, 8])
    ctx.arc(mine.x, mine.y, mine.blastRadius, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.mineBlast
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])

    const armed = mine.fuseTicks !== null
    ctx.beginPath()
    ctx.arc(mine.x, mine.y, mine.bodyRadius, 0, Math.PI * 2)
    ctx.fillStyle = armed ? COLORS.mineArmed : color
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
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
    ctx.lineWidth = 2.5
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
      ctx.arc(actor.x, actor.y, r + 6, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.6)'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (actor.deflectActive) {
      ctx.beginPath()
      ctx.arc(actor.x, actor.y, r + 12, 0, Math.PI * 2)
      ctx.strokeStyle = actor.deflectLevel >= 2 ? '#ffd166' : '#8af5ff'
      ctx.lineWidth = 3
      ctx.setLineDash([10, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (actor.hp < actor.maxHp) {
      const width = r * 2.6
      const ratio = Math.max(0, actor.hp / actor.maxHp)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(actor.x - width / 2, actor.y - r - 14, width, 5)
      ctx.fillStyle = stroke
      ctx.fillRect(actor.x - width / 2, actor.y - r - 14, width * ratio, 5)
    }
  }

  const drawEffect = (effect: EffectView): void => {
    const progress = 1 - effect.ttl / 18
    const alpha = Math.max(0, effect.ttl / 18)

    let color: string = COLORS.fxHit
    if (effect.kind === 'coreHit') color = COLORS.fxCore
    else if (effect.kind === 'explosion') color = COLORS.fxExplosion
    else if (effect.kind === 'death') color = COLORS.fxDeath

    ctx.beginPath()
    ctx.arc(effect.x, effect.y, effect.radius * (0.4 + progress * 0.8), 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const drawHud = (snapshot: Snapshot, debug: RenderDebug): void => {
    const player = snapshot.actors.find((actor) => actor.team === 'player')

    ctx.font = '16px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.hudText
    ctx.fillText(`tick ${snapshot.tick}   fps ${debug.fps.toFixed(0)}`, 20, 18)

    if (player) {
      ctx.fillStyle = COLORS.hudAccent
      ctx.fillText(`HP ${Math.ceil(player.hp)}/${player.maxHp}`, 20, 44)
      if (player.shield > 0) {
        ctx.fillStyle = COLORS.hudText
        ctx.fillText(`SHIELD ${Math.ceil(player.shield)}`, 20, 66)
      }
      ctx.fillStyle = COLORS.hudText
      ctx.fillText(`SHARDS ${Math.floor(snapshot.shards)}`, 20, player.shield > 0 ? 88 : 66)
      ctx.fillText(`KILLS ${snapshot.stats.kills}   CORE ${snapshot.stats.coreHits}`, 20, player.shield > 0 ? 110 : 88)
      if (snapshot.stats.chain > 1) {
        ctx.fillStyle = COLORS.hudWarn
        ctx.fillText(`CHAIN x${snapshot.stats.chain}`, 20, player.shield > 0 ? 132 : 110)
      }
      if (player.deflectLevel > 0) {
        ctx.fillStyle = player.deflectActive ? COLORS.hudWarn : COLORS.hudText
        const state = player.deflectActive ? 'ACTIVE' : player.deflectReady ? 'READY' : 'COOLDOWN'
        ctx.fillText(`DEFLECT ${state}`, 20, player.shield > 0 ? 154 : 132)
      }
    }

    if (snapshot.roomCleared && !snapshot.gameOver) {
      ctx.fillStyle = COLORS.hudWarn
      ctx.fillText('ROOM CLEAR', viewportWidth - 140, 18)
    }
  }

  const drawGameOver = (): void => {
    ctx.fillStyle = COLORS.overlay
    ctx.fillRect(0, 0, viewportWidth, viewportHeight)

    ctx.textAlign = 'center'
    ctx.fillStyle = COLORS.enemyStroke
    ctx.font = '48px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('GAME OVER', viewportWidth / 2, viewportHeight / 2 - 24)

    ctx.fillStyle = COLORS.hudText
    ctx.font = '18px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('按 R 重新开始', viewportWidth / 2, viewportHeight / 2 + 30)
    ctx.textAlign = 'left'
  }

  const draw = (snapshot: Snapshot, debug: RenderDebug): void => {
    const { bounds } = snapshot
    const scale = Math.min(viewportWidth / bounds.width, viewportHeight / bounds.height)
    const offsetX = (viewportWidth - bounds.width * scale) / 2
    const offsetY = (viewportHeight - bounds.height * scale) / 2

    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, viewportWidth, viewportHeight)

    ctx.save()
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)

    drawGrid(bounds)
    drawRoom(bounds, snapshot.walls)
    for (const mine of snapshot.mines) drawMine(mine)
    for (const projectile of snapshot.projectiles) drawProjectile(projectile)
    for (const actor of snapshot.actors) {
      if (actor.alive) drawActor(actor)
    }
    for (const effect of snapshot.effects) drawEffect(effect)

    ctx.restore()

    drawHud(snapshot, debug)
    if (snapshot.gameOver) drawGameOver()
  }

  const dispose = (): void => {
    window.removeEventListener('resize', resize)
  }

  return { draw, dispose }
}