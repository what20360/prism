/**
 * Seedable PRNG (mulberry32). State lives in the world so runs are
 * reproducible and can be hashed for replay verification.
 */
export interface Rng {
  state: number
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 }
}

/** Returns a float in [0, 1) and advances the state. */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0
  let t = rng.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Returns an integer in [min, max). */
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min))
}
