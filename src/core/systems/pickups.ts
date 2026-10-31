import { canCollectCoop, collectCoop, resourceWeights } from '../coop'
import { distance } from '../collision'
import { TICK_DT } from '../types'
import type { World } from '../world'
import { tryGetPlayer, progressOf } from '../world'
import { hasLineOfSight } from '../navigation'
export function updatePickups(world: World): void {
  world.pickups = world.pickups.filter((pickup) => {
    if (pickup.ttl >= 0 && --pickup.ttl <= 0) return false
    const sharedBlood = world.coop && pickup.kind === 'blood' && (world.coop.resourceMode === 'equal' || world.coop.resourceMode === 'damage')
    const needsBlood = sharedBlood ? resourceWeights(world,undefined,pickup.contributions).some(([id,weight])=>{const a=world.actors.get(id);return weight>0&&a?.alive&&a.hp<a.attrs.maxHp}) : false
    const player = world.participants ? [...world.actors.values()]
      .filter((a) => a.alive && canCollectCoop(world,pickup,a) && world.participants![a.id] && (pickup.kind !== 'blood' || (sharedBlood ? needsBlood : a.hp < a.attrs.maxHp)) &&
        (distance(pickup.pos, a.pos) <= a.radius + 16 || a.intent.autoPickup !== false && distance(pickup.pos, a.pos) < a.attrs.pickupRadius && hasLineOfSight(pickup.pos, a.pos, world.room.walls)))
      .sort((a, b) => distance(pickup.pos, a.pos) - distance(pickup.pos, b.pos) || ((a.id + world.tick) % 2) - ((b.id + world.tick) % 2))[0] : tryGetPlayer(world)
    if (!player) return true
    if (pickup.kind === 'blood' && !sharedBlood && player.hp >= player.attrs.maxHp) return true
    const d = distance(pickup.pos, player.pos)
    if (player.intent.autoPickup !== false && d < player.attrs.pickupRadius && d > 1 && hasLineOfSight(pickup.pos, player.pos, world.room.walls)) {
      const travel = Math.min(d, 400 * TICK_DT)
      pickup.pos = { x: pickup.pos.x + (player.pos.x - pickup.pos.x) / d * travel, y: pickup.pos.y + (player.pos.y - pickup.pos.y) / d * travel }
    }
    if (distance(pickup.pos, player.pos) > player.radius + 16) return true
    const value = pickup.value * (pickup.quantity ?? 1)
    const amount = pickup.kind === 'blood' ? sharedBlood ? value : Math.min(player.attrs.maxHp - player.hp, value) : value * (pickup.gainApplied ? 1 : player.attrs.shardGain)
    if (world.coop) collectCoop(world,pickup,player,value)
    else if (pickup.kind === 'blood') player.hp += amount
    else progressOf(world, world.participants ? player.id : undefined).shards += amount
    world.floaters.push({ kind: pickup.kind === 'blood' ? 'heal' : 'shard', value: amount, x: player.pos.x, y: player.pos.y - 50, ttl: 46, driftX: 0 })
    world.effects.push({ kind: 'pickup', x: pickup.pos.x, y: pickup.pos.y, radius: 30, ttl: 12 })
    return false
  })
}
