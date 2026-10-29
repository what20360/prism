import type { AttrSet } from '../core/attrs'
import type { CardRegistry } from '../core/cards'
import type { EconomyRates } from '../core/economy'
import { buyCard as buyCardInWorld, listCardStates, type CardState } from '../core/progress'
import { step } from '../core/simulation'
import { toSnapshot } from '../core/snapshot'
import { TICK_DT } from '../core/types'
import type { EntityId, Vec2 } from '../core/types'
import { createWorld, getPlayer, type RoomTemplate, type World } from '../core/world'
import type { IntentSource } from '../input/keyboard'
import type { Renderer } from '../render/canvas2d/renderer'

export interface PanelState {
  readonly shards: number
  readonly cards: readonly CardState[]
}

export interface GameOptions {
  readonly seed: number
  readonly room: RoomTemplate
  readonly economy: EconomyRates
  readonly registry: CardRegistry
  readonly playerAttrs: AttrSet
  readonly playerSpawn: Vec2
  readonly input: IntentSource
  readonly renderer: Renderer
  readonly onPauseChange?: (paused: boolean) => void
}

export interface Game {
  start(): void
  stop(): void
  dispose(): void
  setPaused(value: boolean): void
  buyCard(cardId: string): void
  panelState(): PanelState
  /** Dev-only inspection hook used by browser verification. */
  debug(): {
    tick: number
    gameOver: boolean
    paused: boolean
    shards: number
    kills: number
    playerX: number
    playerY: number
    mines: number
    projectiles: number
    hp: number
    armor: number
    deflectLevel: number
    purchases: number
  }
}

/** Max catch-up work per frame; guards against tab-restore time jumps. */
const MAX_FRAME_SECONDS = 0.25

export function createGame(options: GameOptions): Game {
  let world: World = createWorld({
    seed: options.seed,
    room: options.room,
    economy: options.economy,
    registry: options.registry,
    playerAttrs: options.playerAttrs,
    playerSpawn: options.playerSpawn,
  })
  let playerId = getPlayer(world).id
  let restarts = 0

  const intents = new Map<EntityId, ReturnType<IntentSource['read']>>()

  let running = false
  let frameHandle = 0
  let lastTime = 0
  let accumulator = 0
  let fps = 0

  const restart = (): void => {
    restarts += 1
    world = createWorld({
      seed: options.seed + restarts,
      room: options.room,
      economy: options.economy,
      registry: options.registry,
      playerAttrs: options.playerAttrs,
      playerSpawn: options.playerSpawn,
    })
    playerId = getPlayer(world).id
    intents.clear()
    accumulator = 0
    options.onPauseChange?.(false)
  }

  const setPaused = (value: boolean): void => {
    if (world.paused === value) return
    world.paused = value
    options.onPauseChange?.(value)
  }

  const frame = (now: number): void => {
    if (!running) return

    if (options.input.consumePanelToggle() && !world.gameOver) {
      setPaused(!world.paused)
    }
    if (options.input.consumeRestart() && world.gameOver) restart()

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

  const buyCard = (cardId: string): void => {
    buyCardInWorld(world, cardId)
  }

  const panelState = (): PanelState => ({
    shards: Math.floor(world.shards),
    cards: listCardStates(world),
  })

  const debug = () => {
    const player = getPlayer(world)
    return {
      tick: world.tick,
      gameOver: world.gameOver,
      paused: world.paused,
      shards: world.shards,
      kills: world.stats.kills,
      playerX: Math.round(player.pos.x),
      playerY: Math.round(player.pos.y),
      mines: world.mines.length,
      projectiles: world.projectiles.length,
      hp: Math.round(player.hp),
      armor: player.attrs.armor,
      deflectLevel: player.attrs.deflectLevel,
      purchases: world.purchases.reduce((sum, purchase) => sum + purchase.level, 0),
    }
  }

  return { start, stop, dispose, setPaused, buyCard, panelState, debug }
}