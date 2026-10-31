import { combatAttrs } from './combat'
import { skillRemaining, skillTotal, unlocked } from './systems/skills'
import type { Actor, SkillId, Pickup, DamageType, MonsterTrait, EnergyTrace, RoomDesign } from './world'
import { ARSENAL_RULES } from './rules'
import type {
  EffectKind,
  EnemyBehavior,
  EnemyTier,
  FloaterKind,
  RoomKind,
  RoomPhase,
  World,
} from './world'
import type { Rect, Team } from './types'
import { TICK_RATE } from './types'

export interface SkillView {
  readonly id: SkillId | null
  readonly level: number
  readonly unlocked: boolean
  readonly cooldown: number
  readonly total: number
  readonly active: boolean
}
export function toSkillView(actor: Actor, id: SkillId | null): SkillView {
  return { id, level: id === null ? 0 : id === 'rage' ? actor.attrs.rageLevel : id === 'dash' ? actor.attrs.dashLevel : actor.attrs.deflectLevel,
    unlocked: id !== null && unlocked(actor.attrs, id), cooldown: id ? skillRemaining(actor, id) : 0,
    total: id ? skillTotal(actor, id) : 0, active: id === 'deflect' ? actor.deflectWindowTicks > 0 : id === 'rage' ? actor.rageTicks > 0 : id === 'dash' ? actor.dashTicks > 0 : false }
}
export interface ActorView {
  readonly weaver?: { readonly mineStock: number; readonly spiderStock: number; readonly volley: number; readonly windup: number; readonly shotTicks: number }
  readonly spider?: { readonly role: 'worker' | 'bomber'; readonly dashUsed: boolean; readonly pursuing: boolean }
  readonly block: number
  readonly physicalResist: number
  readonly electricResist: number
  readonly heatResist: number
  readonly weapon: number
  readonly damageType: DamageType
  readonly traits: readonly MonsterTrait[]
  readonly bombTicks: number | null
  readonly windupTicks: number | null
  readonly windupAngle: number
  readonly shocked: boolean
  readonly burning: boolean
  readonly id: number
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly name: string | null
  readonly x: number
  readonly y: number
  readonly radius: number
  /** Inner (core) hit zone radius; 0 when the actor has no double layer. */
  readonly coreRadius: number
  readonly hp: number
  readonly maxHp: number
  /** Normalized movement direction this tick; used for the movement streak. */
  readonly moveX: number
  readonly moveY: number
  readonly armor: number
  readonly damage: number
  readonly fireRate: number
  readonly movementSpeed: number
  readonly rewardMultiplier: number
  readonly shield: number
  readonly alive: boolean
  readonly aimAngle: number
  /** Ticks left on the "recently hit" highlight; the renderer shows stats while > 0. */
  readonly damageFlashTicks: number
  readonly deflectLevel: number
  readonly deflectActive: boolean
  readonly deflectReady: boolean
  readonly deflectCooldownSeconds: number
  readonly deflectCooldownTotal: number
  readonly deflectFieldRadius: number
  readonly range: number
  readonly fireCooldownSeconds: number
  readonly fireCooldownTotal: number
  readonly mineCooldownSeconds: number
  readonly mineCooldownTotal: number
  readonly autoAim: boolean
  readonly autoFire: boolean
  readonly vision: number
  readonly skills: readonly SkillView[]
  readonly locked: boolean
  readonly manualLocked: boolean
  readonly enraged: boolean
  readonly dashing: boolean
}

export interface ProjectileView {
  readonly damageType: DamageType
  readonly power: number
  readonly id: number
  readonly team: Team
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
  readonly rangeRatio: number
  readonly trail: readonly { x: number; y: number }[]
}

export interface MineView {
  readonly nestRole?: 'queen' | 'worker'
  readonly child: boolean
  readonly pulsesRemaining: number
  readonly pulseCount: number
  readonly id: number
  readonly team: Team
  readonly x: number
  readonly y: number
  readonly bodyRadius: number
  readonly triggerRadius: number
  readonly blastRadius: number
  readonly slowRadius: number
  readonly fuseTicks: number | null
  readonly fuseTotal: number
  readonly grenade: boolean
  readonly ignoreBullets: boolean
}

export interface EffectView {
  readonly kind: EffectKind
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly ttl: number
}

export interface FloaterView {
  readonly kind: FloaterKind
  readonly value: number
  readonly x: number
  readonly y: number
  readonly ttl: number
}

export interface HudStats {
  readonly kills: number
  readonly chain: number
  readonly bestChain: number
  readonly coreHits: number
}

/** Read-only view handed to render/ and ui/. Never mutated by consumers. */
export interface Snapshot {
  readonly design?: RoomDesign
  readonly traces?: readonly EnergyTrace[]
  readonly wave?: { readonly index: number; readonly total: number; readonly countdown: number; readonly spawns: readonly { x: number; y: number; radius: number }[] }
  readonly tick: number
  readonly bounds: Rect
  readonly walls: readonly Rect[]
  readonly actors: readonly ActorView[]
  readonly projectiles: readonly ProjectileView[]
  readonly mines: readonly MineView[]
  readonly pickups: readonly Pickup[]
  readonly effects: readonly EffectView[]
  readonly floaters: readonly FloaterView[]
  readonly shards: number
  readonly score: number
  readonly roomPhase: RoomPhase
  readonly roomKind: RoomKind
  /** True while enemies are queued and the player still stands in the entry area. */
  readonly awaitsEntry: boolean
  readonly exit: Rect | null
  readonly roomCleared: boolean
  readonly gameOver: boolean
  readonly victory: boolean
  readonly stats: HudStats
}

export function toSnapshot(world: World, viewerId?: number): Snapshot {
  const actors: ActorView[] = []
  const player = viewerId === undefined ? [...world.actors.values()].find((a) => a.team === 'player' && a.alive) : world.actors.get(viewerId)
  const viewTeam = (team: Team): Team => player?.team === 'enemy' && team !== 'neutral' ? team === 'player' ? 'enemy' : 'player' : team
  for (const actor of world.actors.values()) {
    const attrs = combatAttrs(actor)
    actors.push({
      block: attrs.block, physicalResist: attrs.physicalResist, electricResist: attrs.electricResist, heatResist: attrs.heatResist,
      weapon: attrs.weapon, damageType: actor.attackType ?? (attrs.weapon === 1 ? 'electric' : attrs.weapon === 2 ? 'heat' : 'physical'),
      traits: actor.traits ?? [], bombTicks: actor.bombTicks ?? null, windupTicks: actor.windupTicks ?? null, windupAngle: actor.windupAngle ?? actor.aimAngle,
      shocked: (actor.shockTicks ?? 0) > 0, burning: actor.burn !== undefined,
      id: actor.id,
      team: viewTeam(actor.team),
      tier: actor.tier,
      weaver: actor.weaver ? { mineStock: actor.weaver.mineStock, spiderStock: actor.weaver.spiderStock, volley: actor.weaver.volley, windup: actor.weaver.volleyTimer, shotTicks: actor.weaver.shotTicks } : undefined,
      spider: actor.spider ? { role: actor.spider.role, dashUsed: actor.spider.dashUsed, pursuing: actor.spider.pursuing } : undefined,
      behavior: actor.behavior,
      name: actor.name ?? null,
      x: actor.pos.x,
      y: actor.pos.y,
      radius: actor.radius,
      coreRadius: actor.hasCore ? actor.radius * actor.attrs.coreRadiusMult : 0,
      hp: actor.hp,
      maxHp: attrs.maxHp,
      armor: attrs.armor,
      damage: attrs.damage,
      fireRate: attrs.fireRate,
      movementSpeed: attrs.speed,
      rewardMultiplier: actor.rewardMultiplier,
      shield: actor.shield,
      moveX: actor.dashTicks > 0 ? actor.dashDirection.x : actor.intent.move.x,
      moveY: actor.dashTicks > 0 ? actor.dashDirection.y : actor.intent.move.y,
      alive: actor.alive,
      aimAngle: actor.aimAngle,
      damageFlashTicks: actor.damageFlashTicks,
      deflectLevel: actor.attrs.deflectLevel,
      deflectActive: actor.deflectWindowTicks > 0,
      deflectReady: actor.attrs.deflectLevel > 0 && actor.deflectCooldownTicks <= 0,
      deflectCooldownSeconds: Math.max(0, actor.deflectCooldownTicks / TICK_RATE),
      deflectCooldownTotal: skillTotal(actor, 'deflect'),
      deflectFieldRadius: actor.attrs.deflectFieldRadius,
      range: actor.attrs.range * (attrs.weapon === 2 ? ARSENAL_RULES.laserRange : 1),
      fireCooldownSeconds: actor.fireCooldownTicks / TICK_RATE,
      fireCooldownTotal: 1 / Math.max(0.001, attrs.fireRate),
      mineCooldownSeconds: actor.mineCooldownTicks / TICK_RATE,
      mineCooldownTotal: actor.attrs.mineCooldown / Math.max(0.01, actor.attrs.mineCooldownRate),
      autoAim: actor.attrs.autoAim > 0,
      autoFire: actor.attrs.autoFire > 0,
      vision: actor.attrs.vision,
      skills: actor.skillSlots.map((id) => toSkillView(actor, id)),
      locked: player?.lockTargetId === actor.id,
      manualLocked: player?.manualLockId === actor.id,
      enraged: actor.rageTicks > 0,
      dashing: actor.dashTicks > 0,
    })
  }

  const projectiles: ProjectileView[] = world.projectiles.map((p) => ({
    damageType: p.damageType ?? 'physical', power: p.damage,
    id: p.id,
    team: viewTeam(p.team),
    x: p.pos.x,
    y: p.pos.y,
    radius: p.radius,
    vx: p.vel.x,
    vy: p.vel.y,
    speed: Math.hypot(p.pos.x - p.prevPos.x, p.pos.y - p.prevPos.y) * TICK_RATE,
    rangeRatio: Math.max(0, Math.min(1, p.travelLeft / Math.max(Number.MIN_VALUE, p.rangeBudget ?? p.travelLeft))),
    trail: p.trail?.map((point) => ({ ...point })) ?? [],
  }))

  const mines: MineView[] = world.mines.map((m) => ({
    child: m.child === true, pulsesRemaining: m.pulsesRemaining ?? 1, pulseCount: m.pulseCount ?? 1,
    id: m.id,
    team: viewTeam(m.team),
    x: m.pos.x,
    y: m.pos.y,
    bodyRadius: m.bodyRadius,
    triggerRadius: m.triggerRadius,
    blastRadius: m.blastRadius,
    slowRadius: m.slowRadius,
    fuseTicks: m.fuseTicks,
    fuseTotal: (m.fuseTotalTicks ?? 5) / TICK_RATE,
    grenade: m.velocity !== undefined,
    ignoreBullets: m.ignoreBullets === true,
    nestRole: m.nestRole,
  }))

  const effects: EffectView[] = world.effects.map((e) => ({
    kind: e.kind,
    x: e.x,
    y: e.y,
    radius: e.radius,
    ttl: e.ttl,
  }))

  const floaters: FloaterView[] = world.floaters.map((f) => ({
    kind: f.kind,
    value: f.value,
    x: f.x,
    y: f.y,
    ttl: f.ttl,
  }))

  return {
    traces: world.traces?.map((t) => ({ ...t, from: { ...t.from }, to: { ...t.to }, team: viewTeam(t.team) })) ?? [],
    wave: world.waves ? { index: world.waves.index, total: world.waves.total, countdown: world.waves.countdown,
      spawns: world.waves.countdown ? (world.waves.remaining[0] ?? []).map((s) => ({ ...s.pos, radius: s.attrs.radius })) : [] } : undefined,
    tick: world.tick,
    bounds: world.room.bounds,
    design: world.room.design,
    walls: world.room.walls,
    actors,
    projectiles,
    mines,
    pickups: world.pickups.map((p) => ({ ...p, pos: { ...p.pos } })),
    effects,
    floaters,
    shards: viewerId === undefined ? world.shards : world.participants?.[viewerId]?.shards ?? world.shards,
    score: world.score,
    roomPhase: world.room.phase,
    roomKind: world.room.kind,
    awaitsEntry: world.room.phase === 'entered' && world.pendingSpawns.length > 0,
    exit: world.room.exit,
    roomCleared: world.roomCleared,
    gameOver: world.gameOver,
    victory: world.victory,
    stats: {
      kills: world.stats.kills,
      chain: world.stats.chain,
      bestChain: world.stats.bestChain,
      coreHits: world.stats.coreHits,
    },
  }
}
