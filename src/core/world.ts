import type { AttrSet } from './attrs'
import type { CardRegistry, Purchase } from './cards'
import { NO_INTENT, type Intent } from './controller'
import type { EconomyRates } from './economy'
import { createRng, type Rng } from './rng'
import type { EntityId, Rect, Team, Vec2 } from './types'

export type RoomPhase = 'idle' | 'entered' | 'combat' | 'cleared' | 'exited'
export type EnemyTier = 'normal' | 'elite' | 'boss'
export type EnemyBehavior = 'chase' | 'turret'

export interface Actor {
  readonly id: EntityId
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
  /** Replaced wholesale when the card pipeline re-resolves. */
  attrs: AttrSet

  pos: Vec2
  radius: number
  hp: number
  shield: number
  alive: boolean
  intent: Intent
  fireCooldownTicks: number
  iframesTicks: number
  mineCooldownTicks: number
  deflectWindowTicks: number
  deflectCooldownTicks: number
  /** Ticks since last taking damage, used for shield regeneration. */
  outOfCombatTicks: number
}

export interface Projectile {
  readonly id: EntityId
  /** Mutable: deflect/reflect transfers ownership mid-flight. */
  ownerId: EntityId
  team: Team
  pos: Vec2
  /** Position at the start of the current tick, used for swept core-hit tests. */
  prevPos: Vec2
  /** Direction times speed (units per second). */
  vel: Vec2
  radius: number
  damage: number
  penetration: number
  pierceLeft: number
  innerMult: number
  travelLeft: number
  /** Targets already hit, so one bullet cannot hit the same actor twice. */
  readonly hitIds: EntityId[]
}

export interface Mine {
  readonly id: EntityId
  readonly ownerId: EntityId
  readonly team: Team
  readonly pos: Vec2
  readonly bodyRadius: number
  readonly triggerRadius: number
  readonly blastRadius: number
  readonly slowRadius: number
  readonly slowFactor: number
  readonly damage: number
  hp: number
  /** null until triggered, then counts down to detonation. */
  fuseTicks: number | null
}

export type EffectKind = 'hit' | 'coreHit' | 'explosion' | 'death' | 'deflect' | 'reflect' | 'revive'

export interface Effect {
  readonly kind: EffectKind
  readonly x: number
  readonly y: number
  readonly radius: number
  ttl: number
}

export interface RoomState {
  phase: RoomPhase
  readonly bounds: Rect
  readonly walls: readonly Rect[]
}

export interface RunStats {
  kills: number
  coreHits: number
  chain: number
  chainIdleTicks: number
  bestChain: number
  damageDealt: number
  damageTaken: number
}

export interface World {
  tick: number
  readonly seed: number
  readonly rng: Rng
  readonly room: RoomState
  readonly economy: EconomyRates
  readonly registry: CardRegistry
  readonly basePlayerAttrs: AttrSet
  readonly actors: Map<EntityId, Actor>
  projectiles: Projectile[]
  mines: Mine[]
  effects: Effect[]
  purchases: Purchase[]
  nextEntityId: EntityId
  shards: number
  score: number
  stats: RunStats
  roomCleared: boolean
  playerTookHit: boolean
  gameOver: boolean
  paused: boolean
  revivesUsed: number
}

export interface RoomTemplate {
  readonly id: string
  readonly bounds: Rect
  readonly walls: readonly Rect[]
  readonly spawns: readonly EnemySpawnSpec[]
}

export interface EnemySpawnSpec {
  readonly pos: Vec2
  readonly attrs: AttrSet
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
}

export interface CreateWorldOptions {
  readonly seed: number
  readonly room: RoomTemplate
  readonly economy: EconomyRates
  readonly registry: CardRegistry
  readonly playerAttrs: AttrSet
  readonly playerSpawn: Vec2
}

export function createWorld(options: CreateWorldOptions): World {
  const world: World = {
    tick: 0,
    seed: options.seed,
    rng: createRng(options.seed),
    room: {
      phase: 'entered',
      bounds: options.room.bounds,
      walls: options.room.walls,
    },
    economy: options.economy,
    registry: options.registry,
    basePlayerAttrs: options.playerAttrs,
    actors: new Map(),
    projectiles: [],
    mines: [],
    effects: [],
    purchases: [],
    nextEntityId: 1,
    shards: 0,
    score: 0,
    stats: {
      kills: 0,
      coreHits: 0,
      chain: 0,
      chainIdleTicks: 0,
      bestChain: 0,
      damageDealt: 0,
      damageTaken: 0,
    },
    roomCleared: false,
    playerTookHit: false,
    gameOver: false,
    paused: false,
    revivesUsed: 0,
  }

  createActor(world, {
    team: 'player',
    tier: 'normal',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: true,
    attrs: options.playerAttrs,
    pos: options.playerSpawn,
  })

  for (const spawn of options.room.spawns) {
    createActor(world, { team: 'enemy', ...spawn })
  }

  return world
}

interface CreateActorSpec {
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
  readonly attrs: AttrSet
  readonly pos: Vec2
}

export function createActor(world: World, spec: CreateActorSpec): Actor {
  const id = world.nextEntityId
  world.nextEntityId += 1

  const actor: Actor = {
    id,
    team: spec.team,
    tier: spec.tier,
    behavior: spec.behavior,
    contactDamage: spec.contactDamage,
    hasCore: spec.hasCore,
    attrs: spec.attrs,
    pos: spec.pos,
    radius: spec.attrs.radius,
    hp: spec.attrs.maxHp,
    shield: spec.attrs.shield,
    alive: true,
    intent: NO_INTENT,
    fireCooldownTicks: 0,
    iframesTicks: 0,
    mineCooldownTicks: 0,
    deflectWindowTicks: 0,
    deflectCooldownTicks: 0,
    outOfCombatTicks: 0,
  }

  world.actors.set(id, actor)
  return actor
}

export function tryGetPlayer(world: World): Actor | undefined {
  for (const actor of world.actors.values()) {
    if (actor.team === 'player' && actor.alive) return actor
  }
  return undefined
}

export function getPlayer(world: World): Actor {
  const player = tryGetPlayer(world)
  if (!player) throw new Error('world has no living player')
  return player
}

export function allocateId(world: World): EntityId {
  const id = world.nextEntityId
  world.nextEntityId += 1
  return id
}
