import type { AttrSet } from '../core/attrs'
import { shieldCap } from '../core/attrs'
import type { CardRegistry } from '../core/cards'
import { applyRoom, type RoomSpec } from '../core/dungeon'
import type { EconomyRates } from '../core/economy'
import { buyCard as buyCardInWorld, listCardStates, type CardState } from '../core/progress'
import { step } from '../core/simulation'
import { toSnapshot } from '../core/snapshot'
import { TICK_DT } from '../core/types'
import type { EntityId } from '../core/types'
import { createWorld, getPlayer, type World } from '../core/world'
import type { IntentSource } from '../input/keyboard'
import type { Renderer } from '../render/canvas2d/renderer'
import type { PlayerView } from '../ui/sections/attrs'

export type UiMode = 'play' | 'menu'

export interface PanelState {
  readonly shards: number
  readonly cards: readonly CardState[]
  readonly player: PlayerView
}

export interface RunSummary {
  readonly victory: boolean
  readonly seconds: number
  readonly kills: number
  readonly coreHits: number
  readonly bestChain: number
  readonly score: number
  readonly shards: number
  readonly floor: number
  readonly room: number
}

export interface GameOptions {
  readonly rooms: readonly RoomSpec[]
  readonly roomsPerFloor: number
  readonly seed: number
  readonly economy: EconomyRates
  readonly registry: CardRegistry
  readonly playerAttrs: AttrSet
  readonly input: IntentSource
  readonly renderer: Renderer
  readonly onUiModeChange?: (mode: UiMode) => void
  readonly onRunEnd?: (summary: RunSummary) => void
}

export interface Game {
  start(): void
  stop(): void
  dispose(): void
  restart(): void
  setUiMode(mode: UiMode): void
  buyCard(cardId: string): void
  panelState(): PanelState
  /** Dev-only inspection hook used by browser verification. */
  debug(): {
    tick: number
    gameOver: boolean
    victory: boolean
    paused: boolean
    roomIndex: number
    roomKind: string
    uiMode: UiMode
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
    enemies: number
  }
}

/** Max catch-up work per frame; guards against tab-restore time jumps. */
const MAX_FRAME_SECONDS = 0.25

export function createGame(options: GameOptions): Game {
  let roomIndex = 0
  let runEnded = false

  const spawnWorld = (seed: number): World => {
    const firstRoom = options.rooms[0]
    if (!firstRoom) throw new Error('dungeon has no rooms')
    return createWorld({
      seed,
      room: firstRoom,
      economy: options.economy,
      registry: options.registry,
      playerAttrs: options.playerAttrs,
    })
  }

  let world = spawnWorld(options.seed)
  let playerId = getPlayer(world).id
  let restarts = 0

  const intents = new Map<EntityId, ReturnType<IntentSource['read']>>()

  let uiMode: UiMode = 'play'
  let running = false
  let frameHandle = 0
  let lastTime = 0
  let accumulator = 0
  let fps = 0

  const summary = (): RunSummary => ({
    victory: world.victory,
    seconds: Math.round(world.tick / 60),
    kills: world.stats.kills,
    coreHits: world.stats.coreHits,
    bestChain: world.stats.bestChain,
    score: Math.round(world.score),
    shards: Math.floor(world.shards),
    floor: Math.floor(roomIndex / options.roomsPerFloor) + 1,
    room: (roomIndex % options.roomsPerFloor) + 1,
  })

  const restart = (): void => {
    restarts += 1
    roomIndex = 0
    runEnded = false
    world = spawnWorld(options.seed + restarts)
    playerId = getPlayer(world).id
    intents.clear()
    accumulator = 0
    uiMode = 'play'
    options.onUiModeChange?.('play')
  }

  const setUiMode = (mode: UiMode): void => {
    if (uiMode === mode && world.paused === (mode !== 'play')) return
    uiMode = mode
    world.paused = mode !== 'play'
    options.onUiModeChange?.(mode)
  }

  const frame = (now: number): void => {
    if (!running) return

    const canToggle = !world.gameOver && !world.victory
    if (options.input.consumeMenuToggle() && canToggle) {
      setUiMode(uiMode === 'menu' ? 'play' : 'menu')
    }
    if (options.input.consumeRestart() && (world.gameOver || world.victory)) restart()

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

    if (world.exitReached && roomIndex + 1 < options.rooms.length) {
      roomIndex += 1
      const next = options.rooms[roomIndex]
      if (next) applyRoom(world, next)
    }

    if (!runEnded && (world.gameOver || world.victory)) {
      runEnded = true
      world.paused = true
      options.onRunEnd?.(summary())
    }

    const label = `F${Math.floor(roomIndex / options.roomsPerFloor) + 1}-${(roomIndex % options.roomsPerFloor) + 1}`
    options.renderer.draw(toSnapshot(world), { fps, label })
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

  const panelState = (): PanelState => {
    const player = getPlayer(world)
    return {
      shards: Math.floor(world.shards),
      cards: listCardStates(world),
      player: {
        attrs: player.attrs,
        hp: player.hp,
        shield: player.shield,
        shieldCap: shieldCap(player.attrs),
      },
    }
  }

  const debug = () => {
    const player = getPlayer(world)
    let enemies = 0
    for (const actor of world.actors.values()) {
      if (actor.alive && actor.team === 'enemy') enemies += 1
    }
    return {
      tick: world.tick,
      gameOver: world.gameOver,
      victory: world.victory,
      paused: world.paused,
      roomIndex,
      roomKind: world.room.kind,
      roomPhase: world.room.phase,
      awaitsEntry: world.room.phase === 'entered' && world.pendingSpawns.length > 0,
      uiMode,
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
      enemies,
    }
  }

  return { start, stop, dispose, restart, setUiMode, buyCard, panelState, debug }
}