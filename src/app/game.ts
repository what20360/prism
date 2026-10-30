import type { AttrSet } from '../core/attrs'
import { shieldCap } from '../core/attrs'
import type { CardRegistry } from '../core/cards'
import { applyRoom, type RoomSpec } from '../core/dungeon'
import type { EconomyRates } from '../core/economy'
import { buyCard as buyCardInWorld, sellCard as sellCardInWorld, listCardStates, type CardState } from '../core/progress'
import { step } from '../core/simulation'
import { toSnapshot, type Snapshot } from '../core/snapshot'
import { TICK_DT } from '../core/types'
import type { EntityId, Vec2 } from '../core/types'
import type { Intent } from '../core/controller'
import { createWorld, getPlayer, tryGetPlayer, type World } from '../core/world'
import type { IntentSource } from '../input/keyboard'
import type { PointerSource } from '../input/pointer'
import type { Renderer } from '../render/canvas2d/renderer'
import type { PlayerView } from '../ui/sections/attrs'
import type { TouchSource } from '../input/touch'
import {
  DEFAULT_SETTINGS,
  type AimMode,
  type FireMode,
  type ControlSettings,
  type SettingKey,
} from '../storage/config'

export { DEFAULT_SETTINGS } from '../storage/config'
export type { AimMode, FireMode, ControlSettings, SettingKey } from '../storage/config'

export type UiMode = 'play' | 'menu'

export interface PanelState {
  readonly shards: number
  readonly cards: readonly CardState[]
  readonly player: PlayerView
  readonly settings: ControlSettings
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
  readonly pointer?: PointerSource
  readonly renderer: Renderer
  readonly touch?: TouchSource
  readonly onSnapshot?: (snapshot: Snapshot, paused: boolean) => void
  readonly initialSettings?: ControlSettings
  readonly onSettingsChange?: (settings: ControlSettings) => void
  readonly onUiModeChange?: (mode: UiMode) => void
  readonly onRunEnd?: (summary: RunSummary) => void
}

export interface Game {
  start(): void
  stop(): void
  dispose(): void
  restart(): void
  setUiMode(mode: UiMode): void
  buyCard(cardId: string): boolean
  sellCard(cardId: string): boolean
  setSetting<K extends SettingKey>(key: K, value: ControlSettings[K]): void
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
    aimMode: AimMode
    fireMode: FireMode
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
  let settings: ControlSettings = { ...DEFAULT_SETTINGS, ...options.initialSettings }
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
    options.input.reset()
    options.pointer?.reset()
    options.touch?.reset()
    lastTime = 0
    accumulator = 0
    fps = 0
    uiMode = 'play'
    options.onUiModeChange?.('play')
  }

  const setUiMode = (mode: UiMode): void => {
    if (uiMode === mode && world.paused === (mode !== 'play')) return
    uiMode = mode
    world.paused = mode !== 'play'
    options.touch?.setPaused(mode !== 'play')
    lastTime = 0
    accumulator = 0
    options.onUiModeChange?.(mode)
  }

  const manualAim = (): Vec2 | undefined => {
    const player = tryGetPlayer(world)
    if (!player || (player.attrs.autoAim > 0 && settings.aimMode === 'auto')) return undefined
    const pointer = options.pointer?.position()
    if (!pointer) return undefined

    const target = options.renderer.viewToWorld(pointer.x, pointer.y)
    const dx = target.x - player.pos.x
    const dy = target.y - player.pos.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return undefined
    return { x: dx / length, y: dy / length }
  }

  /** Settings only change how the player's intent is authored. */
  const playerIntent = (): Intent => {
    const base = options.input.read()
    const touch = options.touch?.read()
    const player = getPlayer(world)
    const move = touch && (touch.move.x !== 0 || touch.move.y !== 0) ? touch.move : base.move
    const automaticAim = player.attrs.autoAim > 0 && settings.aimMode === 'auto'
    const fallback = Math.hypot(move.x, move.y) > 0 ? move : { x: Math.cos(player.aimAngle), y: Math.sin(player.aimAngle) }
    const aim = touch?.aim ?? (automaticAim ? undefined : manualAim() ?? fallback)
    const automaticFire = player.attrs.autoFire > 0 && settings.fireMode === 'auto'
    const fire = automaticFire ? undefined : Boolean(touch?.fire || options.pointer?.firing())
    return { ...base, move, aim, fire, placeMine: base.placeMine || touch?.placeMine, skill: touch?.skill ?? base.skill }
  }

  const setSetting = <K extends SettingKey>(key: K, value: ControlSettings[K]): void => {
    if (settings[key] === value) return
    settings = { ...settings, [key]: value }
    options.onSettingsChange?.({ ...settings })
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
    }

    if (!world.paused && !world.gameOver && !world.victory) {
      accumulator += elapsed

      while (accumulator >= TICK_DT && !world.paused && !world.gameOver && !world.victory) {
        intents.set(playerId, playerIntent())
        step(world, intents)
        accumulator -= TICK_DT
      }
    }

    // A frozen world must not collect input or build a catch-up backlog.
    if (world.paused || world.gameOver || world.victory) accumulator = 0

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
    const snapshot = toSnapshot(world)
    options.renderer.draw(snapshot, { fps, label })
    options.onSnapshot?.(snapshot, world.paused)
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

  const buyCard = (cardId: string): boolean => {
    const result = buyCardInWorld(world, cardId)
    if (!result.ok) return false
    if (cardId === 'auto-aim') setSetting('aimMode', 'auto')
    if (cardId === 'auto-fire') setSetting('fireMode', 'auto')
    return true
  }

  const sellCard = (cardId: string): boolean => {
    if (!sellCardInWorld(world, cardId)) return false
    if (cardId === 'auto-aim') setSetting('aimMode', 'manual')
    if (cardId === 'auto-fire') setSetting('fireMode', 'manual')
    return true
  }

  const panelState = (): PanelState => {
    const player = getPlayer(world)
    return {
      shards: Math.floor(world.shards),
      cards: listCardStates(world),
      settings: { ...settings,
        aimMode: player.attrs.autoAim > 0 ? settings.aimMode : 'manual',
        fireMode: player.attrs.autoFire > 0 ? settings.fireMode : 'manual' },
      player: {
        attrs: player.attrs,
        hp: player.hp,
        shield: player.shield,
        shieldCap: shieldCap(player.attrs),
      },
    }
  }

  const debug = () => {
    // Inspection must keep working on the result screen, where the player is dead.
    const player = world.actors.get(playerId)
    if (!player) throw new Error('world has no player actor')
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
      aimMode: player.attrs.autoAim > 0 ? settings.aimMode : 'manual',
      fireMode: player.attrs.autoFire > 0 ? settings.fireMode : 'manual',
    }
  }

  return { start, stop, dispose, restart, setUiMode, buyCard, sellCard, setSetting, panelState, debug }
}
