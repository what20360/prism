import { PLAYER_BASE_ATTRS } from './player'
export const DUEL_RULES = { countdown: 180, roundTicks: 7200, winsNeeded: 2, inputExpiryMs: 300, disconnectMs: 10000 } as const
export const DUEL_ATTRS = { ...PLAYER_BASE_ATTRS, maxHp: 100, speed: 300, damage: 10, fireRate: 2.5, bulletSpeed: 800, range: 1800,
  pierce: 2, armor: 0, shield: 0, revives: 0, deflectLevel: 1, deflectFieldRadius: 160, deflectFieldStrength: 250, dashLevel: 1,
  autoAim: 0, autoFire: 0, lifesteal: 0, shieldSteal: 0, shardGain: 0 }
export type DuelPhase = 'preparing' | 'countdown' | 'fighting' | 'round-over' | 'finished'
export type DuelWinner = 0 | 1 | 'draw' | null
export interface DuelState {
  readonly round: number; readonly phase: DuelPhase; readonly wins: readonly [number, number]; readonly ready: readonly [boolean, boolean]
  readonly countdown: number; readonly remaining: number; readonly winner: DuelWinner
}
