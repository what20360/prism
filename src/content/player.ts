import type { AttrSet } from '../core/attrs'

/** Numbers mirror docs/balance.md. Never inline these elsewhere. */
export const PLAYER_BASE_ATTRS: AttrSet = {
  maxHp: 100,
  speed: 330,
  radius: 40,
  coreRadiusMult: 0.45,

  armor: 0,
  shield: 0,
  shieldCapMult: 1,
  shieldRegen: 0,

  damage: 10,
  fireRate: 0.7,
  bulletSpeed: 700,
  range: 560,
  pierce: 1,
  bulletSize: 14,
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
  deflectFieldRadius: 0,
  deflectFieldStrength: 0,
}