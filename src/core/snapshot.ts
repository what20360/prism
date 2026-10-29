import type { EffectKind, EnemyBehavior, EnemyTier, RoomPhase, World } from './world'
import type { Rect, Team } from './types'

export interface ActorView {
  readonly id: number
  readonly team: Team
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly x: number
  readonly y: number
  readonly radius: number
  /** Inner (core) hit zone radius; 0 when the actor has no double layer. */
  readonly coreRadius: number
  readonly hp: number
  readonly maxHp: number
  readonly shield: number
  readonly alive: boolean
  readonly deflectLevel: number
  readonly deflectActive: boolean
  readonly deflectReady: boolean
  readonly deflectFieldRadius: number
}

export interface ProjectileView {
  readonly id: number
  readonly team: Team
  readonly x: number
  readonly y: number
  readonly radius: number
}

export interface MineView {
  readonly id: number
  readonly team: Team
  readonly x: number
  readonly y: number
  readonly bodyRadius: number
  readonly triggerRadius: number
  readonly blastRadius: number
  readonly slowRadius: number
  readonly fuseTicks: number | null
}

export interface EffectView {
  readonly kind: EffectKind
  readonly x: number
  readonly y: number
  readonly radius: number
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
  readonly tick: number
  readonly bounds: Rect
  readonly walls: readonly Rect[]
  readonly actors: readonly ActorView[]
  readonly projectiles: readonly ProjectileView[]
  readonly mines: readonly MineView[]
  readonly effects: readonly EffectView[]
  readonly shards: number
  readonly score: number
  readonly roomPhase: RoomPhase
  readonly roomCleared: boolean
  readonly gameOver: boolean
  readonly stats: HudStats
}

export function toSnapshot(world: World): Snapshot {
  const actors: ActorView[] = []
  for (const actor of world.actors.values()) {
    actors.push({
      id: actor.id,
      team: actor.team,
      tier: actor.tier,
      behavior: actor.behavior,
      x: actor.pos.x,
      y: actor.pos.y,
      radius: actor.radius,
      coreRadius: actor.hasCore ? actor.radius * actor.attrs.coreRadiusMult : 0,
      hp: actor.hp,
      maxHp: actor.attrs.maxHp,
      shield: actor.shield,
      alive: actor.alive,
      deflectLevel: actor.attrs.deflectLevel,
      deflectActive: actor.deflectWindowTicks > 0,
      deflectReady: actor.attrs.deflectLevel > 0 && actor.deflectCooldownTicks <= 0,
      deflectFieldRadius: actor.attrs.deflectFieldRadius,
    })
  }

  const projectiles: ProjectileView[] = world.projectiles.map((p) => ({
    id: p.id,
    team: p.team,
    x: p.pos.x,
    y: p.pos.y,
    radius: p.radius,
  }))

  const mines: MineView[] = world.mines.map((m) => ({
    id: m.id,
    team: m.team,
    x: m.pos.x,
    y: m.pos.y,
    bodyRadius: m.bodyRadius,
    triggerRadius: m.triggerRadius,
    blastRadius: m.blastRadius,
    slowRadius: m.slowRadius,
    fuseTicks: m.fuseTicks,
  }))

  const effects: EffectView[] = world.effects.map((e) => ({
    kind: e.kind,
    x: e.x,
    y: e.y,
    radius: e.radius,
    ttl: e.ttl,
  }))

  return {
    tick: world.tick,
    bounds: world.room.bounds,
    walls: world.room.walls,
    actors,
    projectiles,
    mines,
    effects,
    shards: world.shards,
    score: world.score,
    roomPhase: world.room.phase,
    roomCleared: world.roomCleared,
    gameOver: world.gameOver,
    stats: {
      kills: world.stats.kills,
      chain: world.stats.chain,
      bestChain: world.stats.bestChain,
      coreHits: world.stats.coreHits,
    },
  }
}