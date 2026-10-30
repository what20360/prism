import type { AttrSet } from '../core/attrs'
import type { EnemyBehavior, EnemyTier } from '../core/world'

export interface EnemyType {
  readonly name: string
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
  ricochet: 0,
  autoAim: 1,
  autoFire: 1,
  mineDamage: 30,
  mineBlastRadius: 200,
  mineCooldown: 2,
  mineLimit: 3,
  mineSlowMultiplier: 2,
  mineTriggerRadius: 120,
  mineSlowRadius: 120,
  mineCooldownRate: 1,
  mineHp: 1,
  mineFuseSeconds: 0.08,
  mineIgnoreBullets: 0,
  grenade: 0,
  mineFragments: 0,
  mineShardChance: 0,
  bloodOrbChance: 0,
  pickupRadius: 0,
  burstCount: 1,
  homing: 0,
  pierceBoost: 0,
  maxProjectiles: 0,
  vision: 1,
  rageLevel: 0,
  dashLevel: 0,
  skillCooldownRate: 1,

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
  deflectFieldRadius: 0,
  deflectFieldStrength: 0,
}

function enemyAttrs(overrides: Partial<AttrSet>): AttrSet {
  return { ...ZERO_ATTRS, ...overrides }
}

/** Values from docs/balance.md 4. */
export const ENEMIES: Readonly<Record<string, EnemyType>> = {
  drifter: {
    name: 'Drifter',
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
    name: 'Turret',
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

  warden: {
    name: 'Warden',
    tier: 'elite',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: true,
    attrs: enemyAttrs({
      maxHp: 220,
      armor: 60,
      speed: 0,
      radius: 56,
      damage: 12,
      fireRate: 0.9,
      bulletSpeed: 480,
      range: 1100,
      bulletSize: 12,
      multishot: 3,
    }),
  },

  boss: {
    name: 'Prism Heart',
    tier: 'boss',
    behavior: 'boss',
    contactDamage: 0,
    hasCore: true,
    attrs: enemyAttrs({
      maxHp: 2000,
      armor: 80,
      speed: 0,
      radius: 90,
      damage: 12,
      fireRate: 0.6,
      bulletSpeed: 420,
      range: 1800,
      bulletSize: 14,
      multishot: 8,
    }),
  },
}
