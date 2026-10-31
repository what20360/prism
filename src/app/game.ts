import { hasAttackTarget } from '../core/systems/targeting'
import type { PracticeMode, PracticeAction, PracticeState } from './modes/practice'
import type { EndlessMode, EndlessState } from './modes/endless'
import { CURRENT_BALANCE_VERSION, type RunCheckpoint } from './checkpoints'
import { restoreWorld, serializeWorld } from '../core/serialization'
import { validateTargets, moveTarget, removeTarget, type PurchasePlan, type UpgradeTarget, type QuickMode } from './upgradePlans'
import { createPurchaseQueue, type PurchaseNotice } from './purchaseQueue'
import { DUNGEON_START_SHARDS, difficultyName, type DungeonDifficulty } from '../content/difficulties'
import { combatAttrs } from '../core/combat'
import { equipSkill as equipSkillInWorld, SKILL_IDS, unlocked } from '../core/systems/skills'
import { toSkillView, type SkillView } from '../core/snapshot'
import type { SkillId } from '../core/world'
import type { AttrSet } from '../core/attrs'
import { shieldCap } from '../core/attrs'
import type { CardRegistry } from '../core/cards'
import { purchaseLevel } from '../core/cards'
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

export type UiMode = 'play' | 'menu' | 'home'

export interface PanelState {
  readonly dungeon?: { readonly difficulty: DungeonDifficulty; readonly seed: number; readonly wave: number; readonly waves: number }
  readonly shards: number
  readonly cards: readonly CardState[]
  readonly player: PlayerView
  readonly settings: ControlSettings
  readonly skillSlots: readonly (SkillId | null)[]
  readonly knownSkills: readonly SkillView[]
  readonly practice?: PracticeState
  readonly endless?: EndlessState
}

export interface RunSummary {
  readonly difficulty?: DungeonDifficulty
  readonly victory: boolean
  readonly practice?: boolean
  readonly endless?: boolean
  readonly seed?: number
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
  readonly difficulty?: DungeonDifficulty
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
  readonly initialUiMode?: UiMode
  readonly practice?: PracticeMode
  readonly endless?: EndlessMode
  readonly checkpoint?: RunCheckpoint
}

export interface Game {
  plan(): PurchasePlan
  queueUpgrade(id: string, level?: number): boolean
  setPlan(targets: readonly UpgradeTarget[]): boolean
  moveQueued(index: number, direction: -1 | 1): void
  removeQueued(index: number): void
  setAutoBuy(enabled: boolean): void
  setQuickMode(mode: QuickMode): void
  purchaseNotice(): PurchaseNotice | null
  setSaveName(name: string | undefined): void
  checkpoint(): RunCheckpoint | null
  start(): void
  stop(): void
  dispose(): void
  restart(): void
  setUiMode(mode: UiMode): void
  buyCard(cardId: string): boolean
  sellCard(cardId: string): boolean
  equipSkill(slot: number, id: SkillId | null): boolean
  setSetting<K extends SettingKey>(key: K, value: ControlSettings[K]): void
  panelState(): PanelState
  session(): { canResume: boolean; practice: boolean; endless: boolean }
  practiceAction(action: PracticeAction): boolean
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
  if (options.practice && options.endless) throw new Error('a session can only have one mode')
  let roomIndex = options.checkpoint?.roomIndex ?? 0
  let runEnded = false

  const spawnWorld = (seed: number): World => {
    const firstRoom = options.practice?.room() ?? options.endless?.room() ?? options.rooms[0]
    if (!firstRoom) throw new Error('dungeon has no rooms')
    const created = createWorld({
      seed,
      room: firstRoom,
      economy: options.economy,
      registry: options.registry,
      playerAttrs: options.playerAttrs,
    })
    options.practice?.initialize(created)
    options.endless?.initialize(created)
    if (options.difficulty !== undefined) created.shards = DUNGEON_START_SHARDS
    return created
  }

  let world = options.checkpoint ? restoreWorld(options.checkpoint.world, options.registry, options.economy, Object.keys(options.playerAttrs)) : spawnWorld(options.seed)
  if (options.checkpoint?.endless) options.endless?.restore(world, options.checkpoint.endless)
  let playerId = getPlayer(world).id
  let restarts = options.checkpoint?.restarts ?? 0
  let plan: PurchasePlan = options.checkpoint?.plan ? structuredClone(options.checkpoint.plan) : { enabled: true, targets: [] }
  const purchaseQueue = createPurchaseQueue()
  let purchaseNotice: PurchaseNotice | null = null
  let saveName = options.checkpoint?.name

  const intents = new Map<EntityId, ReturnType<IntentSource['read']>>()

  let uiMode: UiMode = options.initialUiMode ?? 'play'
  let hasStarted = Boolean(options.checkpoint) || uiMode !== 'home'
  world.paused = uiMode !== 'play'
  let settings: ControlSettings = { ...DEFAULT_SETTINGS, ...options.initialSettings }
  let running = false
  let frameHandle = 0
  let lastTime = 0
  let accumulator = 0
  let fps = 0

  const summary = (): RunSummary => ({
    difficulty: options.difficulty,
    victory: world.victory,
    practice: Boolean(options.practice),
    endless: Boolean(options.endless), seed: world.seed,
    seconds: Math.round(world.tick / 60),
    kills: world.stats.kills,
    coreHits: world.stats.coreHits,
    bestChain: world.stats.bestChain,
    score: Math.round(world.score),
    shards: Math.floor(world.shards),
    floor: options.endless?.state(world).floor ?? Math.floor(roomIndex / options.roomsPerFloor) + 1,
    room: (roomIndex % options.roomsPerFloor) + 1,
  })

  const restart = (): void => {
    hasStarted = true
    restarts += 1
    roomIndex = 0
    runEnded = false
    plan = { enabled: true, targets: [], quickMode: plan.quickMode }
    saveName = undefined
    purchaseQueue.reset(); purchaseNotice = null
    world = spawnWorld(options.endless || options.difficulty !== undefined ? options.seed : options.seed + restarts)
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
    if (mode === 'play' && (world.gameOver || world.victory)) return
    if (uiMode === mode && world.paused === (mode !== 'play')) return
    options.input.reset(); options.pointer?.reset(); options.touch?.reset()
    if (mode === 'play') hasStarted = true
    uiMode = mode
    world.paused = mode !== 'play'
    purchaseQueue.reset(); purchaseNotice = null
    options.touch?.setPaused(mode !== 'play')
    lastTime = 0
    accumulator = 0
    options.onUiModeChange?.(mode)
  }

  const manualAim = (): Vec2 | undefined => {
    const player = tryGetPlayer(world)
    if (!player) return undefined
    const pointer = options.pointer?.position()
    if (!pointer) return undefined

    const target = options.renderer.viewToWorld(pointer.x, pointer.y, { x: player.pos.x, y: player.pos.y, vision: player.attrs.vision })
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
    const inRange = hasAttackTarget(world, player)
    const automaticAim = inRange && player.attrs.autoAim > 0 && settings.aimMode === 'auto'
    const fallback = Math.hypot(move.x, move.y) > 0 ? move : { x: Math.cos(player.aimAngle), y: Math.sin(player.aimAngle) }
    const aim = touch?.aim ?? manualAim() ?? fallback
    const selection = options.pointer?.consumeLock?.()
    let lockTarget: number | null | undefined
    if (selection !== undefined) {
      const point = selection === null ? null : options.renderer.viewToWorld(selection.x, selection.y, { x: player.pos.x, y: player.pos.y, vision: player.attrs.vision })
      const candidates = point ? [...world.actors.values()].filter((target) => target.alive && target.team !== player.team && Math.hypot(target.pos.x - point.x, target.pos.y - point.y) <= target.radius + 16) : []
      candidates.sort((a, b) => Math.hypot(a.pos.x - point!.x, a.pos.y - point!.y) - Math.hypot(b.pos.x - point!.x, b.pos.y - point!.y))
      lockTarget = candidates[0]?.id ?? null
    }
    const automaticFire = inRange && player.attrs.autoFire > 0 && settings.fireMode === 'auto'
    const fire = automaticFire || Boolean(touch?.fire || options.pointer?.firing())
    return { ...base, move, aim, fire, automaticFire: player.attrs.autoFire > 0 && settings.fireMode === 'auto', autoAim: automaticAim, autoPickup: settings.autoPickup !== false, lockTarget, placeMine: base.placeMine || touch?.placeMine,
      skills: [...(base.skills ?? []), ...(touch?.skills ?? []), ...(base.skill === undefined ? [] : [base.skill]), ...(touch?.skill === undefined ? [] : [touch.skill])] }
  }

  const setSetting = <K extends SettingKey>(key: K, value: ControlSettings[K]): void => {
    if (settings[key] === value) return
    settings = { ...settings, [key]: value }
    options.onSettingsChange?.({ ...settings })
  }

  const frame = (now: number): void => {
    if (!running) return

    const canToggle = !world.gameOver && !world.victory
    if (options.input.consumeMenuToggle() && canToggle && uiMode !== 'home') {
      setUiMode(uiMode === 'menu' ? 'play' : 'menu')
    }
    if (options.input.consumeRestart() && uiMode !== 'home' && (world.gameOver || world.victory)) restart()

    const elapsed = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS)
    lastTime = now

    if (elapsed > 0) {
      fps = fps === 0 ? 1 / elapsed : fps * 0.9 + (1 / elapsed) * 0.1
    }

    if (!world.paused && !world.gameOver && !world.victory) {
      accumulator += elapsed

      while (accumulator >= TICK_DT && !world.paused && !world.gameOver && !world.victory) {
        intents.set(playerId, playerIntent())
        options.practice?.beforeStep(world)
        step(world, intents)
        options.practice?.afterStep(world)
        options.endless?.afterStep(world)
        if (!world.gameOver && !world.victory) purchaseNotice = purchaseQueue.update(plan, listCardStates(world), 1, buyCard)
        accumulator -= TICK_DT
      }
    }

    // A frozen world must not collect input or build a catch-up backlog.
    if (world.paused || world.gameOver || world.victory) accumulator = 0

    if (!options.practice && !options.endless && world.exitReached && roomIndex + 1 < options.rooms.length) {
      roomIndex += 1
      const next = options.rooms[roomIndex]
      if (next) applyRoom(world, next)
    }

    if (!runEnded && (world.gameOver || world.victory)) {
      runEnded = true
      world.paused = true
      options.onRunEnd?.(summary())
    }

    const endless = options.endless?.state(world)
    const label = options.practice ? '测试场' : endless ? `无尽 · 第 ${endless.floor} 层` : `${options.difficulty ? `D${difficultyName(options.difficulty)} · ` : ''}F${Math.floor(roomIndex / options.roomsPerFloor) + 1}-${(roomIndex % options.roomsPerFloor) + 1}`
    const snapshot = toSnapshot(world)
    options.renderer.draw(snapshot, { fps, label, practice: options.practice?.state(world), endless, seed: options.difficulty ? options.seed : undefined })
    options.onSnapshot?.(snapshot, world.paused)
    frameHandle = requestAnimationFrame(frame)
  }

  const start = (): void => {
    if (running) return
    running = true
    options.touch?.setPaused(uiMode !== 'play')
    options.onUiModeChange?.(uiMode)
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
    options.practice?.credit(world, world.registry.get(cardId)?.priceFn(purchaseLevel(world.purchases, cardId) + 1))
    const result = buyCardInWorld(world, cardId)
    if (!result.ok) return false
    options.practice?.credit(world)
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
    const practice = options.practice?.state(world)
    return {
      dungeon: options.difficulty ? { difficulty: options.difficulty, seed: options.seed, wave: world.waves?.index ?? 1, waves: world.waves?.total ?? 1 } : undefined,
      shards: Math.floor(world.shards),
      cards: listCardStates(world).map((card) => practice?.config.freeCards && card.availability === 'not-enough-shards' && Number.isFinite(card.price)
        ? { ...card, availability: 'ok' as const } : card),
      practice,
      endless: options.endless?.state(world),
      skillSlots: [...player.skillSlots],
      knownSkills: SKILL_IDS.filter((id) => unlocked(player.attrs, id)).map((id) => toSkillView(player, id)),
      settings: { ...settings,
        aimMode: player.attrs.autoAim > 0 ? settings.aimMode : 'manual',
        fireMode: player.attrs.autoFire > 0 ? settings.fireMode : 'manual' },
      player: {
        attrs: combatAttrs(player),
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

  const practiceAction = (action: PracticeAction): boolean => {
    if (!options.practice || uiMode !== 'menu' || world.gameOver || world.victory) return false
    if (!options.practice.action(world, action)) return false
    if (action.type === 'card-level' && (action.id === 'auto-aim' || action.id === 'auto-fire')) setSetting(action.id === 'auto-aim' ? 'aimMode' : 'fireMode', action.level > 0 ? 'auto' : 'manual')
    options.input.reset(); options.pointer?.reset(); options.touch?.reset(); options.touch?.setPaused(true)
    lastTime = 0; accumulator = 0
    return true
  }
  const checkpoint = (): RunCheckpoint | null => options.practice || !hasStarted || world.gameOver || world.victory ? null : ({
    format: 'prism-save', version: 1, savedAt: new Date().toISOString(), mode: options.endless ? 'endless' : 'dungeon',
    balanceVersion: CURRENT_BALANCE_VERSION,
    initialSeed: options.seed, restarts, roomIndex, world: serializeWorld(world), endless: options.endless?.checkpoint(),
    difficulty: options.difficulty,
    name: saveName,
    plan: structuredClone(plan),
  })
  const setPlan = (targets: readonly UpgradeTarget[]): boolean => { try { plan.targets = validateTargets(targets); purchaseQueue.reset(); purchaseNotice = null; return true } catch { return false } }
  const queueUpgrade = (id: string, level?: number): boolean => {
    const next = level ?? Math.max(purchaseLevel(world.purchases, id), ...plan.targets.filter((t) => t.id === id).map((t) => t.level)) + 1
    return setPlan([...plan.targets, { id, level: next }])
  }
  return { start, stop, dispose, restart, setUiMode, buyCard, sellCard, checkpoint,
    plan: () => structuredClone(plan), queueUpgrade, setPlan, setAutoBuy: (enabled) => { plan.enabled = enabled; purchaseQueue.reset() },
    setQuickMode: (mode) => { plan.quickMode = mode; purchaseQueue.reset(); purchaseNotice = null }, purchaseNotice: () => purchaseNotice,
    setSaveName: (name) => { saveName = name },
    moveQueued: (index, direction) => { plan.targets = moveTarget(plan.targets, index, direction); purchaseQueue.reset() },
    removeQueued: (index) => { plan.targets = removeTarget(plan.targets, index, (id) => purchaseLevel(world.purchases, id)); purchaseQueue.reset() },
    session: () => ({ canResume: hasStarted && !world.gameOver && !world.victory, practice: Boolean(options.practice), endless: Boolean(options.endless) }), practiceAction, equipSkill: (slot, id) => uiMode === 'menu' && equipSkillInWorld(getPlayer(world), slot, id), setSetting, panelState, debug }
}
