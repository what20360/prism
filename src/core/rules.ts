/** Shared numeric rules used by simulation and generated card descriptions. */
export const CARD_ECONOMY = { growth: 1.6, refundRatio: 0.6 } as const
export const WEAPON_RULES = { burstGapTicks: 4, spreadStep: 0.12 } as const
export const HOMING_RULES = { initialMultiplier: 0.2, cruiseMultiplier: 1, acceleration: 250, baseTurn: 0.65, rootTurn: 0.1 } as const
export const MINE_RULES = { ignoreSlowFactor: 0.45, grenadeSpeed: 160, grenadeTravel: 360 } as const
export const DROP_RULES = { shardValue: 2, bloodMinimum: 4, bloodHpFraction: 0.04 } as const
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
