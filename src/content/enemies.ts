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
  radius: 16,
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
  bulletSize: 6,
  blastRadius: 0,
  penetration: 0,
  multishot: 1,

  lifesteal: 0,
  shieldSteal: 0,

  innerDamageMult: 1.5,
  revives: 0,
  chainCap: 2,
}

function enemyAttrs(overrides: Partial<AttrSet>): AttrSet {
  return { ...ZERO_ATTRS, ...overrides }
}

/** Values from docs/balance.md 4. */
export const ENEMIES: Readonly<Record<string, EnemyType>> = {
  drifter: {
    tier: 'normal',
    behavior: 'chase',
    contactDamage: 8,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 30,
      speed: 135,
      radius: 16,
      damage: 8,
    }),
  },

  turret: {
    tier: 'normal',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 40,
      armor: 20,
      speed: 0,
      radius: 18,
      damage: 10,
      fireRate: 0.8,
      bulletSpeed: 450,
      range: 700,
      bulletSize: 6,
    }),
  },
}
