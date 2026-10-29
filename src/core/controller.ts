import type { Vec2 } from './types'

/**
 * Controllers only describe intent. They never mutate world state,
 * which keeps the player and the AI sharing one simulation path.
 */
export interface Intent {
  /** Normalized movement direction, or ZERO when idle. */
  readonly move: Vec2
  /** Hold-to-place; the simulation applies its own cooldown and stock limit. */
  readonly placeMine?: boolean
  /** Index of the skill slot to activate this tick (0 = first slot). */
  readonly skill?: number
}

export const NO_INTENT: Intent = Object.freeze({
  move: Object.freeze({ x: 0, y: 0 }),
})
