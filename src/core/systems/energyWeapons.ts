import { combatAttrs } from '../combat'
import { distance, distanceToRay } from '../collision'
import { circleEntry } from '../raycast'
import { firstWallHit, hasLineOfSight } from '../navigation'
import { arcProfile, ARSENAL_RULES, laserProfile, finitePower } from '../rules'
import type { Actor, EnergyTrace, World } from '../world'
import type { Vec2 } from '../types'
import { applyDamage } from './damage'

function trace(world: World, owner: Actor, kind: EnergyTrace['kind'], from: Vec2, to: Vec2, ratio: number, power: number): void {
  world.traces ??= []
  if (world.traces.length >= ARSENAL_RULES.traceLimit) world.traces.shift()
  world.traces.push({ damageType: owner.attackType ?? (kind === 'electric' ? 'electric' : 'heat'), ownerId: owner.id, team: owner.team, kind, from: { ...from }, to: { ...to }, rangeRatio: Math.max(0, Math.min(1, ratio)),
    power, width: combatAttrs(owner).bulletSize, ttl: kind === 'electric' ? 10 : ARSENAL_RULES.laserGap + 1 })
}
/** Roots are unique; every branch owns its pierce budget and visited targets. */
export function fireElectric(world: World, owner: Actor, angle: number): void {
  const attrs = combatAttrs(owner), direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const difference = (a: Actor) => { const offset = Math.atan2(a.pos.y - owner.pos.y, a.pos.x - owner.pos.x) - angle; return Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset))) }
  const candidates = [...world.actors.values()].filter((a) => a.alive && a.team !== owner.team && distance(a.pos, owner.pos) <= attrs.range && hasLineOfSight(owner.pos, a.pos, world.room.walls))
    .sort((a, b) => Number(b.id === owner.lockTargetId) - Number(a.id === owner.lockTargetId) || difference(a) - difference(b) || distance(a.pos, owner.pos) - distance(b.pos, owner.pos) || a.id - b.id)
  const roots = candidates.slice(0, Math.min(64, Math.floor(attrs.multishot))), profile = arcProfile(attrs.arcEfficiency)
  for (const root of roots) {
    if (!root.alive) continue
    const budget = Math.max(1, Math.floor(attrs.pierce)), chain = [root], used = new Set([root.id]), distances = [distance(owner.pos, root.pos)]
    while (chain.length < Math.min(64, Math.floor(attrs.burstCount), budget)) {
      const previous = chain[chain.length - 1]!
      const next = [...world.actors.values()].filter((a) => a.alive && a.team !== owner.team && !used.has(a.id) && distance(a.pos, previous.pos) <= Math.min(attrs.range, 220 + attrs.range * 0.2) && hasLineOfSight(previous.pos, a.pos, world.room.walls))
        .sort((a, b) => distance(a.pos, previous.pos) - distance(b.pos, previous.pos) || a.id - b.id)[0]
      if (!next) break
      distances.push(distance(previous.pos, next.pos)); chain.push(next); used.add(next.id)
    }
    const enhanced = Math.min(chain.length - 1, budget - chain.length), surplus = budget - chain.length - enhanced
    let raw = finitePower(attrs.damage * profile.damageMultiplier * (1 + surplus * profile.surplus)), previous = owner.pos
    for (let i = 0; i < chain.length; i++) {
      if (i > 0) raw *= i <= enhanced ? profile.boostedRetention : profile.retention
      const target = chain[i]!
      trace(world, owner, 'electric', previous, target.pos, 1 - distances[i]! / Math.max(1, attrs.range), raw)
      applyDamage(world, { targetId: target.id, sourceId: owner.id, sourceTeam: owner.team, raw, penetration: attrs.penetration, isCore: false, kind: 'electric', damageType: owner.attackType ?? 'electric', rewardMultiplier: owner.rewardMultiplier })
      previous = target.pos
    }
  }
  if (!roots.length) trace(world, owner, 'electric', owner.pos, { x: owner.pos.x + direction.x * Math.min(140, attrs.range), y: owner.pos.y + direction.y * Math.min(140, attrs.range) }, 0.3, attrs.damage)
}

/** A laser pulse resolves segments in order and spends a single pierce budget. */
export function fireLaserPulse(world: World, owner: Actor, angle: number): void {
  const attrs = combatAttrs(owner), rays = Math.min(64, Math.max(1, Math.floor(attrs.multishot))), focus = laserProfile(attrs.laserPower)
  for (let ray = 0; ray < rays; ray++) {
    const direction = angle + (ray - (rays - 1) / 2) * focus.spreadStep
    let dx = Math.cos(direction), dy = Math.sin(direction), from = { ...owner.pos }, left = finitePower(attrs.range * ARSENAL_RULES.laserRange), pierce = Math.max(1, Math.floor(attrs.pierce))
    const granted = left, hit = new Set<number>(), raw = finitePower(attrs.damage * ARSENAL_RULES.laserDamage * focus.damageMultiplier)
    for (let segment = 0; segment < 128 && left > 1e-5 && pierce > 0; segment++) {
      const to = { x: from.x + dx * left, y: from.y + dy * left }, wall = firstWallHit(world.room, from, to, 0)
      let end = wall ? { x: from.x + (to.x - from.x) * wall.t, y: from.y + (to.y - from.y) * wall.t } : to
      const contacts = [...world.actors.values()].filter((a) => a.alive && a.team !== owner.team && !hit.has(a.id))
        .map((actor) => ({ actor, t: circleEntry(from, end, actor.pos, actor.radius + Math.max(1, attrs.bulletSize * 0.35)) }))
        .filter((c): c is { actor: Actor; t: number } => c.t !== null).sort((a, b) => a.t - b.t || a.actor.id - b.actor.id)
      for (const { actor: target, t } of contacts) {
        const core = target.hasCore && pierce >= 2 && distanceToRay(target.pos.x, target.pos.y, from.x, from.y, dx, dy) <= target.radius * target.attrs.coreRadiusMult
        hit.add(target.id); pierce -= core ? 2 : 1
        if (core) world.stats.coreHits++
        applyDamage(world, { targetId: target.id, sourceId: owner.id, sourceTeam: owner.team, raw: raw * (core ? attrs.innerDamageMult : 1), penetration: attrs.penetration, isCore: core, kind: 'laser', damageType: owner.attackType ?? 'heat', rewardMultiplier: owner.rewardMultiplier })
        if (pierce <= 0) { end = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t }; break }
      }
      left -= distance(from, end); trace(world, owner, 'laser', from, end, left / Math.max(1, granted), raw)
      if (!wall || pierce <= 1 || attrs.ricochet <= 0) break
      pierce--; const dot = dx * wall.nx + dy * wall.ny; dx -= 2 * dot * wall.nx; dy -= 2 * dot * wall.ny
      from = { x: end.x + dx * 1e-4, y: end.y + dy * 1e-4 }
    }
  }
}
