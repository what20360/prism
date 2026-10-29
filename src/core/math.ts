import type { Vec2 } from './types'

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 })

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k }
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v)
  return len > 0 ? { x: v.x / len, y: v.y / len } : ZERO
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
