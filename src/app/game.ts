import type { AttrSet } from '../core/attrs'
import { step } from '../core/simulation'
import { toSnapshot } from '../core/snapshot'
import { TICK_DT } from '../core/types'
import type { EntityId, Vec2 } from '../core/types'
import { createWorld, getPlayer, type RoomTemplate } from '../core/world'
import type { IntentSource } from '../input/keyboard'
import type { Renderer } from '../render/canvas2d/renderer'

export interface GameOptions {
  readonly seed: number
  readonly room: RoomTemplate
  readonly playerAttrs: AttrSet
  readonly playerSpawn: Vec2
  readonly input: IntentSource
  readonly renderer: Renderer
}

export interface Game {
  start(): void
  stop(): void
  dispose(): void
}

/** Max catch-up work per frame; guards against tab-restore time jumps. */
const MAX_FRAME_SECONDS = 0.25

export function createGame(options: GameOptions): Game {
  const world = createWorld({
    seed: options.seed,
    room: options.room,
    playerAttrs: options.playerAttrs,
    playerSpawn: options.playerSpawn,
  })

  const playerId = getPlayer(world).id
  const intents = new Map<EntityId, ReturnType<IntentSource['read']>>()

  let running = false
  let frameHandle = 0
  let lastTime = 0
  let accumulator = 0
  let fps = 0

  const frame = (now: number): void => {
    if (!running) return

    const elapsed = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS)
    lastTime = now

    if (elapsed > 0) {
      fps = fps === 0 ? 1 / elapsed : fps * 0.9 + (1 / elapsed) * 0.1
      accumulator += elapsed

      while (accumulator >= TICK_DT) {
        intents.set(playerId, options.input.read())
        step(world, intents)
        accumulator -= TICK_DT
      }
    }

    options.renderer.draw(toSnapshot(world), { fps })
    frameHandle = requestAnimationFrame(frame)
  }

  const start = (): void => {
    if (running) return
    running = true
    lastTime = 0
    accumulator = 0
    frameHandle = requestAnimationFrame(frame)
  }

  const stop = (): void => {
    running = false
    cancelAnimationFrame(frameHandle)
  }

  const dispose = (): void => {
    stop()
    intents.clear()
  }

  return { start, stop, dispose }
}
