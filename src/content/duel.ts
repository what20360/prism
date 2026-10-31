import { PLAYER_BASE_ATTRS } from './player'
import type { PurchasePlan } from '../app/upgradePlans'
import type { PurchaseNotice } from '../app/purchaseQueue'
export const DUEL_RULES = { countdown: 180, roundTicks: 7200, winsNeeded: 2, inputExpiryMs: 300, disconnectMs: 10000,
  initialShards: 600, incomeTicks: 600, income: 15, resourceMinTicks: 240, resourceMaxTicks: 480, monsterMinTicks: 480, monsterMaxTicks: 840,
  monsterLimit: 6, pickupLimit: 24, monsterDrop: 18, projectileLimit: 256, mineLimit: 64 } as const
export const DUEL_MODES = {
  fixed: { name: '固定装备', description: '相同固定装备，枪、地雷、偏转与冲刺；不能购买升级。' },
  budget: { name: '限额构筑', description: '每回合各 600 棱晶，自选构筑；没有额外经济、场内资源或怪物。' },
  resource: { name: '资源争夺', description: '每回合各 600 棱晶，每 10 秒各加 15；随机刷新资源和攻击双方的怪物。' },
} as const
export type DuelMode = keyof typeof DUEL_MODES
export const DUEL_ATTRS = { ...PLAYER_BASE_ATTRS, maxHp: 100, speed: 300, damage: 10, fireRate: 2.5, bulletSpeed: 800, range: 1800,
  pierce: 2, armor: 0, shield: 0, revives: 0, deflectLevel: 1, deflectFieldRadius: 160, deflectFieldStrength: 250, dashLevel: 1,
  autoAim: 0, autoFire: 0, lifesteal: 0, shieldSteal: 0, shardGain: 0 }
export const DUEL_BUILD_ATTRS = { ...DUEL_ATTRS, deflectLevel: 0, deflectFieldRadius: 0, deflectFieldStrength: 0, dashLevel: 0, shardGain: 1 }
export const DUEL_ECONOMY = { tierRate: { normal: 0, elite: 0, boss: 0 }, takenRate: 0, overflowRate: 0 }
export type DuelPhase = 'preparing' | 'countdown' | 'fighting' | 'round-over' | 'finished'
export type DuelWinner = 0 | 1 | 'draw' | null
export interface DuelState {
  readonly mode: DuelMode; readonly round: number; readonly phase: DuelPhase; readonly wins: readonly [number, number]; readonly ready: readonly [boolean, boolean]
  readonly countdown: number; readonly remaining: number; readonly winner: DuelWinner
  readonly plans: readonly [PurchasePlan, PurchasePlan]; readonly notices: readonly [PurchaseNotice | null, PurchaseNotice | null]
}
export type DuelAction = { kind: 'buy' | 'sell' | 'queue'; id: string; level?: number } |
  { kind: 'equip'; slot: number; id: 'deflect' | 'rage' | 'dash' | null } | { kind: 'plan'; targets: PurchasePlan['targets'] } |
  { kind: 'auto'; enabled: boolean } | { kind: 'quick-mode'; mode: 'favorites' | 'planned' } | { kind: 'move'; index: number; direction: -1 | 1 } | { kind: 'remove'; index: number }
