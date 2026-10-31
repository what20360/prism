import type { Actor, World } from './world'
export function mineLimits(actor: Actor) {
  const parents = Math.max(1, Math.floor(actor.attrs.mineLimit))
  return { parents, children: actor.attrs.mineBroodLevel > 0 ? Math.floor(parents * (2 + actor.attrs.mineBroodLevel)) : 0 }
}
/** Equipment changes cannot evade either independent cap. */
export function enforceMineLimits(world: World, actor: Actor): void {
  const limits = mineLimits(actor)
  for (const child of [false, true]) {
    const owned = world.mines.filter((m) => m.ownerId === actor.id && !!m.child === child), limit = child ? limits.children : limits.parents
    const removed = new Set(owned.slice(0, Math.max(0, owned.length - limit)).map((m) => m.id))
    world.mines = world.mines.filter((m) => !removed.has(m.id))
  }
}
