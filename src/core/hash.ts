import type { World } from './world'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * Deterministic state hash used by replay tests: same seed + same intents
 * must produce the same hash at the same tick.
 */
export function hashWorld(world: World): string {
  let hash = FNV_OFFSET

  const mixU32 = (value: number): void => {
    for (let i = 0; i < 4; i += 1) {
      hash ^= (value >>> (i * 8)) & 0xff
      hash = Math.imul(hash, FNV_PRIME) >>> 0
    }
  }

  const mixFixed = (value: number): void => {
    mixU32(Math.round(value * 1e6) >>> 0)
  }

  mixU32(world.tick)
  mixU32(world.rng.state)
  mixU32(world.shards)
  mixU32(world.score)

  for (const actor of world.actors.values()) {
    mixU32(actor.id)
    mixFixed(actor.pos.x)
    mixFixed(actor.pos.y)
    mixFixed(actor.hp)
  }

  return hash.toString(16).padStart(8, '0')
}
