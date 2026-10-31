import { allocateId, type Actor, type World } from '../world'
import { ARSENAL_RULES } from '../rules'
/** Pure emission: callers mark death first, so no damage/kill re-entry is possible. */
export function releaseDeathBurst(world: World, actor: Actor): void {
  if (!actor.traits?.includes('volatile') && actor.behavior !== 'bomber' && actor.behavior !== 'silk-bomber') return
  const count = actor.behavior === 'silk-bomber' ? 8 : ARSENAL_RULES.bombBullets
  for (let i = 0; i < count; i++) {
    if (world.projectiles.length >= ARSENAL_RULES.projectileLimit) world.projectiles.shift()
    const angle = i * Math.PI * 2 / count + actor.id * 0.17, speed = Math.max(180, actor.attrs.bulletSpeed)
    world.projectiles.push({ id: allocateId(world), ownerId: actor.id, team: actor.team, rewardMultiplier: actor.rewardMultiplier,
      damageType: actor.attackType ?? 'heat', pos: { ...actor.pos }, prevPos: { ...actor.pos }, vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      radius: Math.max(6, actor.attrs.bulletSize * 0.65), damage: actor.attrs.damage * 0.7, penetration: actor.attrs.penetration,
      pierceLeft: 1, innerMult: 1, travelLeft: actor.attrs.range, rangeBudget: actor.attrs.range, hitIds: [], trail: [] })
  }
}
