import type { AttrSet } from './attrs'
import { NO_INTENT, type Intent } from './controller'
import { createRng, type Rng } from './rng'
import type { EntityId, Rect, Team, Vec2 } from './types'

export type RoomPhase = 'idle' | 'entered' | 'combat' | 'cleared' | 'exited'

export interface Actor {
  readonly id: EntityId
  readonly team: Team
  pos: Vec2
  radius: number
  hp: number
  readonly attrs: AttrSet
  intent: Intent
}

export interface RoomState {
  phase: RoomPhase
  readonly bounds: Rect
  readonly walls: readonly Rect[]
}

export interface World {
  tick: number
  readonly seed: number
  readonly rng: Rng
  readonly room: RoomState
  readonly actors: Map<EntityId, Actor>
  nextEntityId: EntityId
  shards: number
  score: number
}

export interface RoomTemplate {
  readonly id: string
  readonly bounds: Rect
  readonly walls: readonly Rect[]
}

export interface CreateWorldOptions {
  readonly seed: number
  readonly room: RoomTemplate
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
    actors: new Map(),
    nextEntityId: 1,
    shards: 0,
    score: 0,
  }

  addActor(world, 'player', options.playerSpawn, options.playerAttrs)
  return world
}

export function addActor(world: World, team: Team, pos: Vec2, attrs: AttrSet): Actor {
  const id = world.nextEntityId
  world.nextEntityId += 1

  const actor: Actor = {
    id,
    team,
    pos,
    radius: attrs.radius,
    hp: attrs.maxHp,
    attrs,
    intent: NO_INTENT,
  }

  world.actors.set(id, actor)
  return actor
}

export function getPlayer(world: World): Actor {
  for (const actor of world.actors.values()) {
    if (actor.team === 'player') return actor
  }
  throw new Error('world has no player actor')
}
