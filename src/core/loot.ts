import { nextFloat, type Rng } from './rng'
import { KILL_LOOT_RULES as RULES } from './rules'
import { allocateId, type Pickup, type World } from './world'
import type { Vec2 } from './types'
import { resolveSpawnPosition } from './collision'

export const LOOT_DENOMINATIONS = [625, 125, 25, 5, 1] as const
export interface LootStack { readonly value: number; readonly quantity: number }
/** Expected units: whole units are certain, only the fractional unit is rolled. */
export function killDropProbability(level: number, overkill: number, monsterMaxHp: number): number {
  return Math.max(0, level) * RULES.levelChance + Math.max(0, overkill) * RULES.overkillChance + Math.max(0, monsterMaxHp) / RULES.hpDivisor
}
export function rollLootAmount(rng: Rng, probability: number): number {
  const expected = Math.max(0, Math.min(RULES.limit, probability)), whole = Math.floor(expected), fraction = expected - whole
  return whole + (fraction > 0 && nextFloat(rng) < fraction ? 1 : 0)
}
/** Greedy denominations; identical pieces share one entity to bound busy scenes. */
export function packLoot(amount: number): LootStack[] {
  let remaining = Math.max(0, Math.floor(Math.min(Number.MAX_SAFE_INTEGER, amount)))
  const stacks: LootStack[] = []
  for (const value of LOOT_DENOMINATIONS) {
    const quantity = Math.floor(remaining / value)
    if (quantity > 0) { stacks.push({ value, quantity }); remaining -= value * quantity }
  }
  return stacks
}
export function spawnLoot(world: World, kind: Pickup['kind'], pos: Vec2, amount: number, ttl: number, limit = world.participants ? 24 : 100): void {
  const stacks = packLoot(amount)
  if (!stacks.length || world.pickups.filter((p) => p.ttl > 0).length < Math.max(0, world.pickups.length + stacks.length - limit)) return
  // Reserve the complete pack before spawning, so new large pieces are not evicted by its small pieces.
  while (world.pickups.length + stacks.length > limit) {
    const index = world.pickups.findIndex((p) => p.ttl > 0)
    if (index < 0) return
    world.pickups.splice(index, 1)
  }
  stacks.forEach((stack, index) => world.pickups.push({ ...stack, id: allocateId(world), kind, ttl,
    pos: resolveSpawnPosition({ x: pos.x + (index - (stacks.length - 1) / 2) * 27, y: pos.y }, 18, world.room.walls, world.room.bounds) }))
}
