import { TICK_RATE } from './types'
export const WEAVER_RULES = {
  mineLimit: 6, mineCache: 3, mineRegen: 6 * TICK_RATE, mineCooldown: 2 * TICK_RATE, mineRadius: 64, mineScale: 1.5,
  mineBlast: 190, mineTrigger: 180, mineSlow: 200, mineFuse: 42, shieldDisruptTicks: 3600, attackMineSpeed: 180, attackMineRange: 600,
  spiderLimit: 6, spiderCache: 6, spiderRegen: 4 * TICK_RATE, summonGap: 2 * TICK_RATE, sacrifice: 1 / 36,
  workerLimit: 3, workerLifetime: 45 * TICK_RATE, mineJitter: 72,
  volleyCooldown: 10 * TICK_RATE, volleyGap: TICK_RATE, volleyWindup: 18, firstWindup: 30, fanStep: 0.12, fanLayers: [0.72, 1, 1.28],
  acquireRange: 850, dashRange: 420, dashTicks: 24, spiderTrigger: 115, spiderFuse: 36, spiderBlast: 150, spiderDamage: 2,
} as const
