/**
 * Attribute set shared by every actor (player and rival-type enemies alike).
 * Values are resolved from cards; derived stats such as mitigation are
 * computed on demand so there is only one source of truth.
 */
export interface AttrSet {
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
  mineSlow: number

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
export function resolveDamage(raw: number, armor: number, penetration: number): number {
  const effectiveArmor = Math.max(0, armor - penetration)
  return Math.max(0, raw * (1 - armorToMitigation(effectiveArmor)))
}

export function shieldCap(attrs: AttrSet): number {
  return attrs.maxHp * attrs.shieldCapMult
}
