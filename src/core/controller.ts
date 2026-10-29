import type { Vec2 } from './types'

/**
 * Controllers only describe intent. They never mutate world state,
 * which keeps the player and the AI sharing one simulation path.
 */
export interface Intent {
  /** Normalized movement direction, or ZERO when idle. */
  readonly move: Vec2
}

export const NO_INTENT: Intent = Object.freeze({
  move: Object.freeze({ x: 0, y: 0 }),
})
