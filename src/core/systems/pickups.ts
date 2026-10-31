import { distance } from '../collision'
import { TICK_DT } from '../types'
import type { World } from '../world'
import { tryGetPlayer, progressOf } from '../world'
import { hasLineOfSight } from '../navigation'
export function updatePickups(world: World): void {
  world.pickups = world.pickups.filter((pickup) => {
    if (pickup.ttl >= 0 && --pickup.ttl <= 0) return false
    const player = world.participants ? [...world.actors.values()]
      .filter((a) => a.alive && world.participants![a.id] && (pickup.kind !== 'blood' || a.hp < a.attrs.maxHp) &&
        (distance(pickup.pos, a.pos) <= a.radius + 16 || a.intent.autoPickup !== false && distance(pickup.pos, a.pos) < a.attrs.pickupRadius && hasLineOfSight(pickup.pos, a.pos, world.room.walls)))
      .sort((a, b) => distance(pickup.pos, a.pos) - distance(pickup.pos, b.pos) || ((a.id + world.tick) % 2) - ((b.id + world.tick) % 2))[0] : tryGetPlayer(world)
    if (!player) return true
    if (pickup.kind === 'blood' && player.hp >= player.attrs.maxHp) return true
    const d = distance(pickup.pos, player.pos)
    if (player.intent.autoPickup !== false && d < player.attrs.pickupRadius && d > 1 && hasLineOfSight(pickup.pos, player.pos, world.room.walls)) {
      const travel = Math.min(d, 400 * TICK_DT)
      pickup.pos = { x: pickup.pos.x + (player.pos.x - pickup.pos.x) / d * travel, y: pickup.pos.y + (player.pos.y - pickup.pos.y) / d * travel }
    }
    if (distance(pickup.pos, player.pos) > player.radius + 16) return true
    const amount = pickup.kind === 'blood' ? Math.min(player.attrs.maxHp - player.hp, pickup.value) : pickup.value * (pickup.gainApplied ? 1 : player.attrs.shardGain)
    if (pickup.kind === 'blood') player.hp += amount
    else progressOf(world, world.participants ? player.id : undefined).shards += amount
    world.floaters.push({ kind: pickup.kind === 'blood' ? 'heal' : 'shard', value: amount, x: player.pos.x, y: player.pos.y - 50, ttl: 46, driftX: 0 })
    world.effects.push({ kind: 'pickup', x: pickup.pos.x, y: pickup.pos.y, radius: 30, ttl: 12 })
    return false
  })
}
