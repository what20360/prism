export const TICK_RATE = 60
export const TICK_DT = 1 / TICK_RATE

export type Team = 'player' | 'enemy' | 'neutral'

export type EntityId = number

export interface Vec2 {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
