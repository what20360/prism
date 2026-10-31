import { circleIntersectsRect, distance } from './collision'
import { nextFloat, nextInt, type Rng } from './rng'
import { ROOM_RESOURCE_RULES as RULES } from './rules'
import { packLoot } from './loot'
import type { PickupSpawnSpec, RoomTemplate, World } from './world'

/** Room-entry resources are deterministic, obstacle-free and never timed out. */
export function createRoomPickups(rng: Rng, room: Pick<RoomTemplate, 'bounds' | 'walls' | 'entry'>): PickupSpawnSpec[] {
  const result: PickupSpawnSpec[] = [], b = room.bounds
  const position = () => {
    for (let attempt = 0; attempt < 128; attempt++) {
      const pos = { x: b.x + 100 + nextFloat(rng) * (b.width - 200), y: b.y + 240 + nextFloat(rng) * (b.height - 400) }
      if (distance(pos, room.entry) < 180 || room.walls.some((wall) => circleIntersectsRect(pos.x, pos.y, 22, wall)) || result.some((p) => distance(pos, p.pos) < 90)) continue
      return pos
    }
    return { x: b.x + b.width / 2, y: b.y + 300 }
  }
  const blood = nextInt(rng, RULES.bloodMin, RULES.bloodMax + 1), shards = nextInt(rng, RULES.shardMin, RULES.shardMax + 1)
  for (let i = 0; i < blood; i++) result.push({ kind: 'blood', pos: position(), value: RULES.bloodValue })
  for (let i = 0; i < shards; i++) result.push({ kind: 'shard', pos: position(), value: nextInt(rng, RULES.shardValueMin, RULES.shardValueMax + 1) })
  return result
}
export function populateRoomPickups(world: World, supplied?: readonly PickupSpawnSpec[]): void {
  world.pickups = (supplied ?? createRoomPickups(world.rng, world.room)).flatMap((pickup) => packLoot(pickup.value * (pickup.quantity ?? 1)).map((stack, index) => {
    const offset = { x: pickup.pos.x, y: pickup.pos.y + index * 28 }
    const pos = world.room.walls.some((wall) => circleIntersectsRect(offset.x, offset.y, 22, wall)) || offset.y > world.room.bounds.y + world.room.bounds.height - 22 ? pickup.pos : offset
    return { ...pickup, ...stack, pos: { ...pos }, id: world.nextEntityId++, ttl: -1 }
  }))
}
