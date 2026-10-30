import type { AttrSet } from './attrs'
import type { CardRegistry, Purchase } from './cards'
import { resolveSpawnPosition } from './collision'
import { populateRoomPickups } from './roomResources'
import { NO_INTENT, type Intent } from './controller'
import type { EconomyRates } from './economy'
import { createRng, type Rng } from './rng'
import type { EntityId, Rect, Team, Vec2 } from './types'

export type RoomPhase = 'idle' | 'entered' | 'combat' | 'cleared' | 'exited'
export type EnemyTier = 'normal' | 'elite' | 'boss'
export type EnemyBehavior = 'chase' | 'turret' | 'boss'

export type RoomKind = 'safe' | 'combat' | 'guard' | 'boss'
export type SkillId = 'deflect' | 'rage' | 'dash'

export interface Actor {
  readonly id: EntityId
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
  readonly rewardMultiplier: number
  readonly damageIframesTicks?: number
  /** Display name from content; enemies leave it undefined for plain shapes. */
  readonly name?: string
  /** Replaced wholesale when the card pipeline re-resolves. */
  attrs: AttrSet

  pos: Vec2
  radius: number
  hp: number
  shield: number
  alive: boolean
  intent: Intent
  /** Last resolved shot direction in radians, used for the aim indicator. */
  aimAngle: number
  /** Ticks left on the "just got hit" highlight that shows target stats. */
  damageFlashTicks: number
  fireCooldownTicks: number
  /** Boss phase (1 or 2); unused for regular enemies. */
  phase: number
  /** Cooldown for boss-only special attacks. */
  specialCooldownTicks: number
  iframesTicks: number
  mineCooldownTicks: number
  deflectWindowTicks: number
  deflectCooldownTicks: number
  /** Ticks since last taking damage, used for shield regeneration. */
  outOfCombatTicks: number
  lockTargetId: EntityId | null
  manualLockId: EntityId | null
  skillSlots: [SkillId | null, SkillId | null]
  rageTicks: number
  dashTicks: number
  rageCooldownTicks: number
  dashCooldownTicks: number
  dashDirection: Vec2
  burstRemaining: number
  burstTimer: number
  burstAngle: number
  navPath: Vec2[]
  navTimer: number
  navGoal: Vec2
}

export interface Projectile {
  readonly id: EntityId
  /** Mutable: deflect/reflect transfers ownership mid-flight. */
  ownerId: EntityId
  rewardMultiplier?: number
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
  /** Remaining path length, consumed by actual motion rather than elapsed time. */
  travelLeft: number
  /** Total distance granted at launch and by penetration; used for range feedback. */
  rangeBudget?: number
  /** Contacts still awaiting separation before this projectile may hit again. */
  readonly hitIds: EntityId[]
  pierceSpeedMultiplier?: number
  pierceRangeGain?: number
  ricochet?: boolean
  blastRadius?: number
  resolvedTick?: number
  targetId?: EntityId | null
  homingTurn?: number
  cruiseSpeed?: number
  trail?: Vec2[]
  segments?: { from: Vec2; to: Vec2 }[]
}

export interface Mine {
  readonly id: EntityId
  readonly ownerId: EntityId
  readonly rewardMultiplier?: number
  readonly team: Team
  pos: Vec2
  readonly bodyRadius: number
  readonly triggerRadius: number
  readonly blastRadius: number
  readonly slowRadius: number
  readonly slowMultiplier: number
  readonly damage: number
  hp: number
  /** null until triggered, then counts down to detonation. */
  fuseTicks: number | null
  fuseTotalTicks?: number
  ignoreBullets?: boolean
  velocity?: Vec2
  travelLeft?: number
  fragments?: number
}

export interface Pickup {
  readonly id: EntityId
  readonly kind: 'blood' | 'shard'
  pos: Vec2
  readonly value: number
  ttl: number
}

export type EffectKind = 'hit' | 'coreHit' | 'explosion' | 'death' | 'deflect' | 'reflect' | 'revive' | 'rage' | 'dash' | 'pickup'

export interface Effect {
  readonly kind: EffectKind
  readonly x: number
  readonly y: number
  readonly radius: number
  ttl: number
}

export type FloaterKind = 'damage' | 'overflow' | 'taken' | 'shard' | 'heal'

/**
 * Short-lived combat text. Purely cosmetic, so it is deliberately excluded from
 * `hashWorld` — replays compare the simulation, not the presentation.
 */
export interface Floater {
  readonly kind: FloaterKind
  readonly value: number
  x: number
  y: number
  ttl: number
  readonly driftX: number
}

export interface RoomState {
  phase: RoomPhase
  kind: RoomKind
  readonly bounds: Rect
  walls: readonly Rect[]
  /** Where the player appeared; used to delay spawning until they step in. */
  entry: Vec2
  /** Opens once the room is cleared; null while fighting. */
  exit: Rect | null
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
  /** Enemies queued on room transition, spawned once the player steps in. */
  pendingSpawns: EnemySpawnSpec[]
  projectiles: Projectile[]
  mines: Mine[]
  pickups: Pickup[]
  effects: Effect[]
  /** Cosmetic combat text; not part of the deterministic state hash. */
  floaters: Floater[]
  purchases: Purchase[]
  nextEntityId: EntityId
  shards: number
  score: number
  stats: RunStats
  roomCleared: boolean
  playerTookHit: boolean
  exitReached: boolean
  gameOver: boolean
  victory: boolean
  paused: boolean
  revivesUsed: number
}

export interface RoomTemplate {
  readonly id: string
  readonly kind: RoomKind
  readonly bounds: Rect
  readonly walls: readonly Rect[]
  readonly spawns: readonly EnemySpawnSpec[]
  /** Where the player appears when entering. */
  readonly entry: Vec2
  /** Omit for seeded room resources; [] gives a clean testing scene. */
  readonly pickups?: readonly PickupSpawnSpec[]
}

export interface PickupSpawnSpec { readonly kind: Pickup['kind']; readonly pos: Vec2; readonly value: number }

export interface EnemySpawnSpec {
  readonly damageIframesTicks?: number
  readonly pos: Vec2
  readonly attrs: AttrSet
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
  readonly rewardMultiplier?: number
  /** Display name shown by the target info card. */
  readonly name?: string
}

export interface CreateWorldOptions {
  readonly seed: number
  readonly room: RoomTemplate
  readonly economy: EconomyRates
  readonly registry: CardRegistry
  readonly playerAttrs: AttrSet
}

export function createWorld(options: CreateWorldOptions): World {
  const world: World = {
    tick: 0,
    seed: options.seed,
    rng: createRng(options.seed),
    room: {
      phase: 'combat',
      kind: options.room.kind,
      bounds: options.room.bounds,
      walls: options.room.walls,
      entry: options.room.entry,
      exit: null,
    },
    economy: options.economy,
    registry: options.registry,
    basePlayerAttrs: options.playerAttrs,
    actors: new Map(),
    pendingSpawns: [],
    projectiles: [],
    mines: [],
    pickups: [],
    effects: [],
    floaters: [],
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
    exitReached: false,
    gameOver: false,
    victory: false,
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
    pos: options.room.entry,
  })

  populateRoomPickups(world, options.room.pickups)

  for (const spawn of options.room.spawns) {
    spawnEnemy(world, spawn)
  }

  return world
}

interface CreateActorSpec {
  readonly damageIframesTicks?: number
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
  readonly rewardMultiplier?: number
  readonly attrs: AttrSet
  readonly pos: Vec2
  readonly name?: string
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
    rewardMultiplier: spec.rewardMultiplier ?? 1,
    damageIframesTicks: spec.damageIframesTicks,
    name: spec.name,
    attrs: spec.attrs,
    pos: spec.pos,
    radius: spec.attrs.radius,
    hp: spec.attrs.maxHp,
    shield: spec.attrs.shield,
    alive: true,
    intent: NO_INTENT,
    aimAngle: 0,
    damageFlashTicks: 0,
    fireCooldownTicks: 0,
    phase: 1,
    specialCooldownTicks: 0,
    iframesTicks: 0,
    mineCooldownTicks: 0,
    deflectWindowTicks: 0,
    deflectCooldownTicks: 0,
    outOfCombatTicks: 0,
    lockTargetId: null,
    manualLockId: null,
    skillSlots: initialSkills(spec.attrs),
    rageTicks: 0, dashTicks: 0, rageCooldownTicks: 0, dashCooldownTicks: 0,
    dashDirection: { x: 1, y: 0 },
    burstRemaining: 0, burstTimer: 0, burstAngle: 0,
    navPath: [], navTimer: 0, navGoal: spec.pos,
  }

  world.actors.set(id, actor)
  return actor
}

/** Enemy spawn point, snapped out of walls so no enemy starts inside geometry. */
export function spawnEnemy(world: World, spec: EnemySpawnSpec): Actor {
  const pos = resolveSpawnPosition(
    spec.pos,
    spec.attrs.radius,
    world.room.walls,
    world.room.bounds,
  )
  return createActor(world, { team: 'enemy', ...spec, pos })
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

function initialSkills(attrs: AttrSet): [SkillId | null, SkillId | null] {
  const ids: SkillId[] = []
  if (attrs.deflectLevel > 0) ids.push('deflect')
  if (attrs.rageLevel > 0) ids.push('rage')
  if (attrs.dashLevel > 0) ids.push('dash')
  return [ids[0] ?? null, ids[1] ?? null]
}
