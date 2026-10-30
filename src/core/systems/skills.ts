import type { AttrSet } from '../attrs'
import { normalize } from '../math'
import { TICK_RATE } from '../types'
import { rageProfile, dashProfile } from '../rules'
import type { Actor, SkillId, World } from '../world'
export const SKILL_IDS: readonly SkillId[] = ['deflect', 'rage', 'dash']
export function unlocked(attrs: AttrSet, id: SkillId): boolean { return (id === 'deflect' ? attrs.deflectLevel : id === 'rage' ? attrs.rageLevel : attrs.dashLevel) > 0 }
export function skillTotal(actor: Actor, id: SkillId): number { return (id === 'deflect' ? actor.attrs.deflectCooldownSeconds : id === 'rage' ? rageProfile(actor.attrs.rageLevel).cooldown : dashProfile(actor.attrs.dashLevel).cooldown) / Math.max(0.01, actor.attrs.skillCooldownRate) }
export function skillRemaining(actor: Actor, id: SkillId): number { return (id === 'deflect' ? actor.deflectCooldownTicks : id === 'rage' ? actor.rageCooldownTicks : actor.dashCooldownTicks) / TICK_RATE }
export function equipSkill(actor: Actor, slot: number, id: SkillId | null): boolean {
  if ((slot !== 0 && slot !== 1) || (id !== null && !unlocked(actor.attrs, id))) return false
  const other = slot === 0 ? 1 : 0
  if (id !== null && actor.skillSlots[other] === id) actor.skillSlots[other] = actor.skillSlots[slot]
  actor.skillSlots[slot] = id
  if (!actor.skillSlots.includes('rage')) actor.rageTicks = 0
  if (!actor.skillSlots.includes('dash')) actor.dashTicks = 0
  if (!actor.skillSlots.includes('deflect')) actor.deflectWindowTicks = 0
  return true
}
export function reconcileSkills(actor: Actor, previous: AttrSet): void {
  for (const slot of [0, 1] as const) if (actor.skillSlots[slot] && !unlocked(actor.attrs, actor.skillSlots[slot]!)) equipSkill(actor, slot, null)
  for (const id of SKILL_IDS) {
    if (!unlocked(actor.attrs, id) || unlocked(previous, id) || actor.skillSlots.includes(id)) continue
    const empty = actor.skillSlots.indexOf(null)
    if (empty >= 0) actor.skillSlots[empty as 0 | 1] = id
  }
}
export function tryActivateDeflect(world: World, actor: Actor): boolean {
  if (!unlocked(actor.attrs, 'deflect') || actor.deflectCooldownTicks > 0 || actor.deflectWindowTicks > 0) return false
  actor.deflectWindowTicks = Math.max(1, Math.round(actor.attrs.deflectWindowSeconds * TICK_RATE))
  actor.deflectCooldownTicks = Math.max(1, Math.round(skillTotal(actor, 'deflect') * TICK_RATE))
  world.effects.push({ kind: 'deflect', x: actor.pos.x, y: actor.pos.y, radius: actor.radius + 16, ttl: 10 })
  return true
}
export function tryActivateSkill(world: World, actor: Actor, slot: number): boolean {
  const id = actor.skillSlots[slot as 0 | 1]
  if (!id || !unlocked(actor.attrs, id) || skillRemaining(actor, id) > 0) return false
  if (id === 'deflect') return tryActivateDeflect(world, actor)
  if (id === 'rage') { actor.rageTicks = Math.max(1, Math.round(rageProfile(actor.attrs.rageLevel).duration * TICK_RATE)); actor.rageCooldownTicks = Math.max(1, Math.round(skillTotal(actor, id) * TICK_RATE)) }
  else {
    actor.dashTicks = Math.max(1, Math.round(dashProfile(actor.attrs.dashLevel).duration * TICK_RATE)); actor.dashCooldownTicks = Math.max(1, Math.round(skillTotal(actor, id) * TICK_RATE))
    actor.dashDirection = Math.hypot(actor.intent.move.x, actor.intent.move.y) > 0.01 ? normalize(actor.intent.move) : { x: Math.cos(actor.aimAngle), y: Math.sin(actor.aimAngle) }
  }
  world.effects.push({ kind: id, x: actor.pos.x, y: actor.pos.y, radius: actor.radius * (id === 'rage' ? 2 : 1.4), ttl: 18 })
  return true
}
