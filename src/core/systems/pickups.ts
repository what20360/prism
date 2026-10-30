import { distance } from '../collision'
import { TICK_DT } from '../types'
import type { World } from '../world'
import { tryGetPlayer } from '../world'
import { hasLineOfSight } from '../navigation'
export function updatePickups(world: World): void {
  const player = tryGetPlayer(world)
  world.pickups = world.pickups.filter((pickup) => {
    pickup.ttl -= 1
    if (pickup.ttl <= 0) return false
    if (!player) return true
    const d = distance(pickup.pos, player.pos)
    if (d < player.attrs.pickupRadius && d > 1 && hasLineOfSight(pickup.pos, player.pos, world.room.walls)) {
      const travel = Math.min(d, 400 * TICK_DT)
      pickup.pos = { x: pickup.pos.x + (player.pos.x - pickup.pos.x) / d * travel, y: pickup.pos.y + (player.pos.y - pickup.pos.y) / d * travel }
    }
    if (distance(pickup.pos, player.pos) > player.radius + 16) return true
    const amount = pickup.kind === 'blood' ? Math.min(player.attrs.maxHp - player.hp, pickup.value) : pickup.value
    if (pickup.kind === 'blood') player.hp += amount
    else world.shards += amount
    world.floaters.push({ kind: pickup.kind === 'blood' ? 'heal' : 'shard', value: amount, x: player.pos.x, y: player.pos.y - 50, ttl: 46, driftX: 0 })
    world.effects.push({ kind: 'pickup', x: pickup.pos.x, y: pickup.pos.y, radius: 30, ttl: 12 })
    return false
  })
}
