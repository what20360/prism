import type { AttrSet } from '../core/attrs'
import type { EnemyBehavior, EnemyTier } from '../core/world'

export interface EnemyType {
  readonly attrs: AttrSet
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
}

const ZERO_ATTRS: AttrSet = {
  maxHp: 30,
  speed: 0,
  radius: 34,
  coreRadiusMult: 0.45,

  armor: 0,
  shield: 0,
  shieldCapMult: 1,
  shieldRegen: 0,

  damage: 0,
  fireRate: 0,
  bulletSpeed: 0,
  range: 0,
  pierce: 1,
  bulletSize: 10,
  blastRadius: 0,
  penetration: 0,
  multishot: 1,

  lifesteal: 0,
  shieldSteal: 0,

  innerDamageMult: 1.5,
  revives: 0,
  chainCap: 2,
  shardGain: 1,

  deflectLevel: 0,
  deflectWindowSeconds: 0.25,
  deflectCooldownSeconds: 6,
  reflectDamageMult: 1.5,
  passiveDeflectRate: 0,
}

function enemyAttrs(overrides: Partial<AttrSet>): AttrSet {
  return { ...ZERO_ATTRS, ...overrides }
}

/** Values from docs/balance.md 4. */
export const ENEMIES: Readonly<Record<string, EnemyType>> = {
  drifter: {
    tier: 'normal',
    behavior: 'chase',
    contactDamage: 6,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 20,
      speed: 150,
      radius: 34,
      damage: 6,
    }),
  },

  turret: {
    tier: 'normal',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 30,
      armor: 20,
      speed: 0,
      radius: 40,
      damage: 10,
      fireRate: 0.6,
      bulletSpeed: 380,
      range: 900,
      bulletSize: 10,
    }),
  },
}