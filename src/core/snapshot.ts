import type { Rect, Team } from './types'
import type { RoomPhase, World } from './world'

export interface ActorView {
  readonly id: number
  readonly team: Team
  readonly x: number
  readonly y: number
  readonly radius: number
  /** Inner (core) hit zone radius, rendered so the double-layer rule is visible. */
  readonly coreRadius: number
  readonly hp: number
  readonly maxHp: number
}

/** Read-only view handed to render/ and ui/. Never mutated by consumers. */
export interface Snapshot {
  readonly tick: number
  readonly bounds: Rect
  readonly walls: readonly Rect[]
  readonly actors: readonly ActorView[]
  readonly shards: number
  readonly roomPhase: RoomPhase
}

export function toSnapshot(world: World): Snapshot {
  const actors: ActorView[] = []

  for (const actor of world.actors.values()) {
    actors.push({
      id: actor.id,
      team: actor.team,
      x: actor.pos.x,
      y: actor.pos.y,
      radius: actor.radius,
      coreRadius: actor.radius * actor.attrs.coreRadiusMult,
      hp: actor.hp,
      maxHp: actor.attrs.maxHp,
    })
  }

  return {
    tick: world.tick,
    bounds: world.room.bounds,
    walls: world.room.walls,
    actors,
    shards: world.shards,
    roomPhase: world.room.phase,
  }
}
