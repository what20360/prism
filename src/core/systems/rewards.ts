import type { Actor, EnemyTier, World } from '../world'

export function tierRateFor(world: World, tier: EnemyTier): number {
  return world.economy.tierRate[tier]
}

/** Current chain multiplier, capped by the player's chainCap attr. */
export function chainMultiplier(world: World, player: Actor): number {
  return Math.min(player.attrs.chainCap, 1 + 0.1 * Math.max(0, world.stats.chain - 1))
}
/** Shards earned from damaging an enemy, including partial overkill. */
export function offenseShards(
  world: World,
  tier: EnemyTier,
  effectiveDamage: number,
  overkill: number,
  player: Actor,
): number {
  const rate = tierRateFor(world, tier)
  const chain = chainMultiplier(world, player)
  const counted = effectiveDamage + overkill * world.economy.overflowRate
  return counted * rate * chain
}

/** Shards earned from taking a hit, computed on pre-mitigation damage. */
export function takenShards(world: World, rawDamage: number): number {
  return rawDamage * world.economy.takenRate
}

export function registerKill(world: World, player: Actor): void {
  world.stats.kills += 1
  world.stats.chain += 1
  world.stats.chainIdleTicks = 0
  if (world.stats.chain > world.stats.bestChain) world.stats.bestChain = world.stats.chain

  const maxChain = Math.ceil((player.attrs.chainCap - 1) / 0.1) + 1
  if (world.stats.chain > maxChain) world.stats.chain = maxChain
}

export function breakChain(world: World): void {
  world.stats.chain = 0
  world.stats.chainIdleTicks = 0
}