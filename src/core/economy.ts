/** Rates that turn damage into shards. Values live in content/economy.ts. */
export interface EconomyRates {
  /** Shards per point of damage, by enemy tier. */
  readonly tierRate: {
    readonly normal: number
    readonly elite: number
    readonly boss: number
  }
  /** Shards per point of pre-mitigation damage taken. */
  readonly takenRate: number
  /** Fraction of overkill damage that still counts. */
  readonly overflowRate: number
}
