import type { EconomyRates } from '../core/economy'

/** Mirrors docs/balance.md 5.1-5.4. Tune only here. */
export const DEFAULT_ECONOMY: EconomyRates = {
  tierRate: {
    normal: 0.1,
    elite: 0.12,
    boss: 0.05,
  },
  takenRate: 0.05,
  overflowRate: 0.5,
  roomClear: 10,
  roomClearNoHit: 5,
}
