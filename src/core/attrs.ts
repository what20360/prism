/**
 * Attribute set shared by every actor (player and rival-type enemies alike).
 * Values are resolved from cards; derived stats such as mitigation are
 * computed on demand so there is only one source of truth.
 */
export interface AttrSet {
  block: number
  physicalResist: number
  electricResist: number
  heatResist: number
  weapon: number
  arcEfficiency: number
  laserPower: number
  minePulseLevel: number
  mineBroodLevel: number
  maxHp: number
  speed: number
  radius: number
  coreRadiusMult: number

  armor: number
  shield: number
  shieldCapMult: number
  shieldRegen: number

  damage: number
  fireRate: number
  bulletSpeed: number
  range: number
  pierce: number
  bulletSize: number
  blastRadius: number
  penetration: number
  multishot: number
  ricochet: number
  autoAim: number
  autoFire: number
  mineDamage: number
  mineBlastRadius: number
  mineCooldown: number
  mineLimit: number
  mineSlowMultiplier: number
  mineTriggerRadius: number
  mineSlowRadius: number
  mineCooldownRate: number
  mineHp: number
  mineFuseSeconds: number
  mineIgnoreBullets: number
  grenade: number
  mineFragments: number
  /** Historical storage key: guaranteed crystal-loot level per kill. */
  mineShardChance: number
  /** Historical storage key: guaranteed blood-orb level per kill. */
  bloodOrbChance: number
  pickupRadius: number
  burstCount: number
  homing: number
  pierceBoost: number
  maxProjectiles: number
  vision: number
  rageLevel: number
  dashLevel: number
  skillCooldownRate: number

  lifesteal: number
  shieldSteal: number

  innerDamageMult: number
  revives: number
  chainCap: number

  /** Multiplier applied to every shard gain (card: 棱晶收益加成). */
  shardGain: number

  deflectLevel: number
  deflectWindowSeconds: number
  deflectCooldownSeconds: number
  reflectDamageMult: number
  /** Continuous deflection field: radius in world units (0 = no field). */
  deflectFieldRadius: number
  /** Outward acceleration at the centre, in units/s^2 (falls off with distance). */
  deflectFieldStrength: number
}

export type AttrKey = keyof AttrSet

/**
 * mitigation = armor / (100 + armor)
 * Asymptotically approaches 1 but can never reach it, so no cap is needed.
 */
export function armorToMitigation(armor: number): number {
  if (armor <= 0) return 0
  return armor / (100 + armor)
}

/** Damage after armor penetration, never negative. */
export function resolveDamage(raw: number, armor: number, penetration: number, block = 0, resistance = 0): number {
  const effectiveArmor = Math.max(0, armor - penetration)
  return Math.max(0, raw - Math.max(0, block)) * (1 - armorToMitigation(effectiveArmor)) * 100 / (100 + Math.max(-80, resistance))
}

/** Added in balance version 4; only the versioned importer fills legacy files. */
export const ARSENAL_DEFAULTS = { block: 0, physicalResist: 0, electricResist: 0, heatResist: 0, weapon: 0,
  arcEfficiency: 0, laserPower: 0, minePulseLevel: 0, mineBroodLevel: 0 } as const

export function shieldCap(attrs: AttrSet): number {
  return attrs.shield > 0 ? attrs.maxHp * attrs.shieldCapMult : 0
}
