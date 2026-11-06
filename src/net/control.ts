import type { Intent } from '../core/controller'
import type { DuelAction } from '../content/duel'
import { finite, integer, record } from '../core/serialization'
import { CARD_REGISTRY } from '../content/cards'
import { validateQuickMode, validateTargets } from '../app/upgradePlans'
export const IDLE_INPUT: Intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, placeMine: false, skills: [], autoAim: false }
/** Consume edge events once while held buttons survive until the input heartbeat expires. */
export function createRemoteInput() {
  let consumed=-1,consumedTicks=0
  let sequence = -1, receivedAt = -Infinity, intent: Intent = IDLE_INPUT, offers = false
  return {
    accept: (packet: { sequence: number; round: number; intent: Intent; offers?: boolean }, round: number, now: number) => {
      if (packet.sequence <= sequence || packet.round !== round) return false
      sequence = packet.sequence; receivedAt = now; offers = packet.offers === true
      intent = { ...packet.intent, skills: [...new Set([...(intent.skills ?? []), ...(packet.intent.skills ?? [])])], lockTarget: packet.intent.lockTarget === undefined ? intent.lockTarget : packet.intent.lockTarget }; return true
    },
    inspect: (now: number) => ({sequence,ageMs:Number.isFinite(receivedAt)?Math.max(0,now-receivedAt):null,expired:now-receivedAt>350,move:{...intent.move},fire:intent.fire===true,offers}),
    ack: (now:number) => ({sequence:consumed,ticks:consumedTicks,expired:now-receivedAt>350}),
    read: (now: number): Intent => { if (now - receivedAt > 350) return IDLE_INPUT; if(consumed!==sequence){consumed=sequence;consumedTicks=0};consumedTicks++;const value = intent; intent = { ...intent, skills: [], lockTarget: undefined }; return value },
    offersVisible: (now: number) => offers && now - receivedAt <= 350,
    reset: () => { consumed=-1;consumedTicks=0;intent = IDLE_INPUT; receivedAt = -Infinity; sequence = -1 },
  }
}
function direction(value: unknown) {
  const p = record(value), x = finite(p.x, -1, 1), y = finite(p.y, -1, 1), length = Math.max(1, Math.hypot(x, y))
  return { x: x / length, y: y / length }
}
export function cleanIntent(value: unknown): Intent {
  const d = record(value)
  const skills = Array.isArray(d.skills) ? [...new Set(d.skills.slice(0, 8))].filter((x) => x === 0 || x === 1) as number[] : []
  return { move: direction(d.move), aim: d.aim ? direction(d.aim) : undefined, fire: d.fire === true, placeMine: d.placeMine === true,
    skills, automaticFire: d.automaticFire === true, autoAim: d.autoAim === true, autoPickup: d.autoPickup !== false,
    lockTarget: d.lockTarget === null ? null : d.lockTarget === undefined ? undefined : integer(d.lockTarget, 1) }
}
export function cleanAction(value: unknown): DuelAction {
  const d = record(value)
  if (d.kind === 'buy' || d.kind === 'sell' || d.kind === 'queue') {
    if (typeof d.id !== 'string' || !CARD_REGISTRY.get(d.id)) throw new Error('未知卡片')
    return { kind: d.kind, id: d.id, level: d.kind === 'queue' && d.level !== undefined ? integer(d.level, 1, CARD_REGISTRY.get(d.id)!.maxLevel) : undefined }
  }
  if (d.kind === 'equip') { if (![null, 'deflect', 'rage', 'dash'].includes(d.id as never)) throw new Error('技能无效'); return { kind: 'equip', slot: integer(d.slot, 0, 1), id: d.id as 'deflect' | 'rage' | 'dash' | null } }
  if (d.kind === 'plan') return { kind: 'plan', targets: validateTargets(d.targets) }
  if (d.kind === 'auto') { if (typeof d.enabled !== 'boolean') throw new Error('预购开关无效'); return { kind: 'auto', enabled: d.enabled } }
  if (d.kind === 'quick-mode') return { kind: 'quick-mode', mode: validateQuickMode(d.mode) }
  if (d.kind === 'move') { if (d.direction !== -1 && d.direction !== 1) throw new Error('队列方向无效'); return { kind: 'move', index: integer(d.index, 0, 2047), direction: d.direction } }
  if (d.kind === 'remove') return { kind: 'remove', index: integer(d.index, 0, 2047) }
  throw new Error('未知购买操作')
}
