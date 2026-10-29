import type { ActorView, Snapshot } from '../../core/snapshot'
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
    for (const actor of snapshot.actors) drawActor(actor)

    ctx.restore()
    drawHud(snapshot, debug)
  }

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

  const drawActor = (actor: ActorView): void => {
    ctx.beginPath()
    ctx.arc(actor.x, actor.y, actor.radius, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.playerFill
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = COLORS.playerStroke
    ctx.stroke()

    // Inner core zone: makes the double-layer hitbox rule legible.
    ctx.beginPath()
    ctx.arc(actor.x, actor.y, actor.coreRadius, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.playerCore
    ctx.fill()
  }

  const drawHud = (snapshot: Snapshot, debug: RenderDebug): void => {
    const player = snapshot.actors.find((actor) => actor.team === 'player')

    ctx.font = '16px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.hudText
    ctx.fillText(`tick ${snapshot.tick}`, 20, 18)
    ctx.fillText(`fps ${debug.fps.toFixed(0)}`, 20, 40)

    if (player) {
      ctx.fillStyle = COLORS.hudAccent
      ctx.fillText(`HP ${player.hp}/${player.maxHp}`, 20, 68)
      ctx.fillStyle = COLORS.hudText
      ctx.fillText(`SHARDS ${snapshot.shards}`, 20, 90)
    }
  }

  const dispose = (): void => {
    window.removeEventListener('resize', resize)
  }

  return { draw, dispose }
}
