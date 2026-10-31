/** Shared numeric rules used by simulation and generated card descriptions. */
export const CARD_ECONOMY = { growth: 1.6, refundRatio: 0.6 } as const
export const WEAPON_RULES = { burstGapTicks: 4, spreadStep: 0.12 } as const
export const HOMING_RULES = { initialMultiplier: 0.2, cruiseMultiplier: 1, acceleration: 250, baseTurn: 1, rootTurn: 0.6 } as const
export const ROOM_RESOURCE_RULES = { bloodMin: 1, bloodMax: 2, shardMin: 3, shardMax: 5, bloodValue: 10, shardValueMin: 4, shardValueMax: 6 } as const
export function penetrationProfile(level: number) { return { speedMultiplier: 1 + 0.12 * level, rangeGain: 60 * level } }
export const MINE_RULES = { ignoreSlowFactor: 0.65, grenadeSpeed: 160, grenadeTravel: 360 } as const
export const DROP_RULES = { shardValue: 3, bloodMinimum: 4, bloodHpFraction: 0.04 } as const
export const ARSENAL_RULES = { laserRange: 1.8, laserDamage: 0.7, laserTicks: 12, laserGap: 6,
  arcLoss: 0.38, arcBoostedLoss: 0.15, arcSurplus: 0.15, traceLimit: 256, projectileLimit: 2048, mineLimit: 256, pulseGap: 8,
  shockTicks: 45, shockSpeed: 0.8, burnInterval: 20, burnHits: 3, burnDamage: 0.15,
  bombTrigger: 220, bombRadius: 250, bombFuse: 54, bombDamage: 2.6, bombBullets: 18 } as const
export function arcProfile(level: number) { const efficiency = 1 + 0.25 * level; return { damageMultiplier: 1 + 0.2 * level, retention: 1 - ARSENAL_RULES.arcLoss / efficiency, boostedRetention: 1 - ARSENAL_RULES.arcBoostedLoss / efficiency, surplus: ARSENAL_RULES.arcSurplus * efficiency } }
export function broodProfile(level: number) { return { children: Math.floor(2 * level), inherit: 0.4 + 0.35 * level / (level + 3), capMultiplier: 2 + level, lifetime: 900 } }
export function pulseProfile(level: number) { return { count: 1 + Math.floor(level), divisor: 1 + 0.45 * level } }
export const KILL_LOOT_RULES = { shardValue: 2, bloodMinimum: 2, bloodFraction: 0.025, overkillFactor: 0.75 } as const
export function killLootBase(level: number, maxHp: number) { return { shard: KILL_LOOT_RULES.shardValue * level, blood: Math.max(KILL_LOOT_RULES.bloodMinimum, maxHp * KILL_LOOT_RULES.bloodFraction) * level } }
export function killLootBoost(overkill: number, maxHp: number): number { return 1 + KILL_LOOT_RULES.overkillFactor * Math.log2(1 + Math.max(0, overkill) / Math.max(1, maxHp)) }
/** Numeric representation guard, not a progression/level limit. */
export function finitePower(value: number): number { return Math.max(0, Math.min(Number.MAX_VALUE / 1e6, value)) }
export const DEFLECT_RULES = { activeForceMultiplier: 5 } as const

export function homingProfile(level: number) {
  return { initialMultiplier: level > 0 ? HOMING_RULES.initialMultiplier : 1,
    cruiseMultiplier: HOMING_RULES.cruiseMultiplier,
    turnRate: level > 0 ? HOMING_RULES.baseTurn + HOMING_RULES.rootTurn * Math.sqrt(level) : 0 }
}
export function rageProfile(level: number) {
  return { duration: 5, cooldown: 14, damageMultiplier: 1 + 0.5 * level, fireRateMultiplier: 1 + 0.5 * level,
    armor: 30 * level, lifesteal: 0.1 * level }
}
export function dashProfile(level: number) { return { duration: 0.22, cooldown: 1.4, speedMultiplier: 1 + 1.8 * level } }
export function mineSlowMultiplier(multiplier: number, ignoreBullets: boolean): number {
  return 1 + Math.max(0, multiplier - 1) * (ignoreBullets ? MINE_RULES.ignoreSlowFactor : 1)
}
