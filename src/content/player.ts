import type { AttrSet } from '../core/attrs'

/** Numbers mirror docs/balance.md 1-2. Never inline these elsewhere. */
export const PLAYER_BASE_ATTRS: AttrSet = {
  maxHp: 100,
  speed: 330,
  radius: 18,
  coreRadiusMult: 0.45,

  armor: 0,
  shield: 0,
  shieldCapMult: 1,
  shieldRegen: 0,

  damage: 10,
  fireRate: 1.2,
  bulletSpeed: 900,
  range: 960,
  pierce: 1,
  bulletSize: 8,
  blastRadius: 0,
  penetration: 0,
  multishot: 1,

  lifesteal: 0,
  shieldSteal: 0,

  innerDamageMult: 1.5,
  revives: 0,
  chainCap: 2,
}
