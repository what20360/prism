import type { AttrSet } from '../core/attrs'
import { ARSENAL_DEFAULTS } from '../core/attrs'
import type { EnemyBehavior, EnemyTier, EnemyMechanics } from '../core/world'

export interface EnemyType extends EnemyMechanics {
  readonly name: string
  readonly attrs: AttrSet
  readonly tier: EnemyTier
  readonly behavior: EnemyBehavior
  readonly contactDamage: number
  readonly hasCore: boolean
}

const ZERO_ATTRS: AttrSet = {
  ...ARSENAL_DEFAULTS,
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
    name: '游荡者',
    tier: 'normal',
    behavior: 'chase',
    contactDamage: 9,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 32,
      speed: 185,
      radius: 34,
      damage: 9,
    }),
  },

  turret: {
    name: '哨戒炮台',
    tier: 'normal',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: false,
    attrs: enemyAttrs({
      maxHp: 55,
      armor: 25,
      speed: 0,
      radius: 40,
      damage: 13,
      fireRate: 0.8,
      bulletSpeed: 430,
      range: 900,
      bulletSize: 10,
    }),
  },

  warden: {
    name: '核心守卫',
    tier: 'elite',
    behavior: 'turret',
    contactDamage: 0,
    hasCore: true,
    attrs: enemyAttrs({
      maxHp: 280,
      armor: 65, block: 3, shield: 45, shieldRegen: 4,
      speed: 0,
      radius: 56,
      damage: 18,
      fireRate: 1.1,
      bulletSpeed: 480,
      range: 1100,
      bulletSize: 12,
      multishot: 3,
    }),
  },

  boss: {
    name: '棱镜之心',
    tier: 'boss',
    behavior: 'boss',
    contactDamage: 0,
    hasCore: true,
    attrs: enemyAttrs({
      maxHp: 3000,
      armor: 90, block: 5,
      speed: 0,
      radius: 90,
      damage: 18,
      fireRate: 0.85,
      bulletSpeed: 500,
      range: 1800,
      bulletSize: 14,
      multishot: 10,
    }),
  },
  bomber: { name: '自爆体', tier: 'normal', behavior: 'bomber', contactDamage: 0, hasCore: false, attackType: 'heat', traits: ['volatile'],
    attrs: enemyAttrs({ maxHp: 42, speed: 230, radius: 32, damage: 16, bulletSpeed: 330, range: 850 }) },
  stalker: { name: '游猎射手', tier: 'normal', behavior: 'skirmish', contactDamage: 7, hasCore: false, attackType: 'physical',
    attrs: enemyAttrs({ maxHp: 60, armor: 10, speed: 170, radius: 34, damage: 10, fireRate: 1.2, bulletSpeed: 580, range: 1000, multishot: 2 }) },
  lancer: { name: '灼线哨兵', tier: 'elite', behavior: 'lancer', contactDamage: 0, hasCore: true, attackType: 'heat',
    attrs: enemyAttrs({ maxHp: 100, armor: 35, block: 2, speed: 100, radius: 42, damage: 20, fireRate: 0.45, range: 900, weapon: 2, pierce: 2 }) },

}
