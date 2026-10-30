import type { World } from './world'
/** Hash every future-affecting state field; cosmetic trails, effects and text stay out. */
export function hashWorld(world: World): string {
  let hash = 0x811c9dc5
  const mix = (text: string) => { for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 } }
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) { mix('null;'); return }
    if (typeof value === 'number') { mix(`n${Math.round(value * 1e6)};`); return }
    if (typeof value !== 'object') { mix(`${typeof value}:${String(value)};`); return }
    if (Array.isArray(value)) { mix('['); value.forEach(visit); mix(']'); return }
    const object = value as Record<string, unknown>
    mix('{')
    for (const key of Object.keys(object).sort()) { if (['trail', 'damageFlashTicks', 'segments'].includes(key)) continue; mix(key + ':'); visit(object[key]) }
    mix('}')
  }
  visit({ tick: world.tick, seed: world.seed, rng: world.rng.state, shards: world.shards, score: world.score,
    nextId: world.nextEntityId, room: world.room, spawns: world.pendingSpawns, purchases: world.purchases,
    actors: [...world.actors.values()].sort((a, b) => a.id - b.id), projectiles: world.projectiles, mines: world.mines,
    pickups: world.pickups, stats: world.stats, roomCleared: world.roomCleared, playerTookHit: world.playerTookHit,
    exitReached: world.exitReached, gameOver: world.gameOver, victory: world.victory, paused: world.paused, revivesUsed: world.revivesUsed })
  return hash.toString(16).padStart(8, '0')
}
