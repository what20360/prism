import type { Intent } from '../core/controller'
import { finite, integer, record, restoreWorld, type WorldData } from '../core/serialization'
import { CARD_REGISTRY } from '../content/cards'
import { resolveAttrs } from '../core/cards'
import { DUEL_ATTRS, DUEL_BUILD_ATTRS, DUEL_ECONOMY, DUEL_MODES, DUEL_RULES, type DuelState, type DuelAction } from '../content/duel'
import { validateQuickMode, validateTargets } from '../app/upgradePlans'
export const DUEL_PROTOCOL = 3
export const MAX_PACKET_BYTES = 512 * 1024
export const IDLE_INPUT: Intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, placeMine: false, skills: [], autoAim: false }
export function createRemoteInput() {
  let sequence = -1, receivedAt = -Infinity, intent: Intent = IDLE_INPUT, offers = true
  return {
    accept: (packet: Extract<DuelPacket, { type: 'input' }>, round: number, now: number) => {
      if (packet.sequence <= sequence || packet.round !== round) return false
      sequence = packet.sequence; receivedAt = now; offers = packet.offers !== false
      intent = { ...packet.intent, skills: [...new Set([...(intent.skills ?? []), ...(packet.intent.skills ?? [])])], lockTarget: packet.intent.lockTarget === undefined ? intent.lockTarget : packet.intent.lockTarget }; return true
    },
    read: (now: number): Intent => { if (now - receivedAt > DUEL_RULES.inputExpiryMs) return IDLE_INPUT; const value = intent; intent = { ...intent, skills: [], lockTarget: undefined }; return value },
    offersVisible: (now: number) => offers && now - receivedAt <= DUEL_RULES.inputExpiryMs,
    reset: () => { intent = IDLE_INPUT; receivedAt = -Infinity },
  }
}
export type DuelPacket = { type: 'input'; sequence: number; round: number; intent: Intent; offers?: boolean } | { type: 'ready' } | { type: 'forfeit' } |
  { type: 'action'; sequence: number; round: number; action: DuelAction } |
  { type: 'ping' | 'pong'; time: number } | { type: 'state'; serial: number; state: DuelState; world: WorldData }
function direction(value: unknown) {
  const p = record(value), x = finite(p.x, -1, 1), y = finite(p.y, -1, 1), length = Math.max(1, Math.hypot(x, y))
  return { x: x / length, y: y / length }
}
export function cleanIntent(value: unknown): Intent {
  const d = record(value)
  const skills = Array.isArray(d.skills) ? [...new Set(d.skills.slice(0, 8))].filter((x) => x === 0 || x === 1) as number[] : []
  return { move: direction(d.move), aim: d.aim ? direction(d.aim) : undefined, fire: d.fire === true, placeMine: d.placeMine === true,
    skills, autoAim: d.autoAim === true, autoPickup: d.autoPickup !== false,
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
export function encodePacket(packet: DuelPacket): string { return JSON.stringify({ protocol: DUEL_PROTOCOL, ...packet }) }
export function decodePacket(text: string): DuelPacket {
  if (text.length > MAX_PACKET_BYTES) throw new Error('消息过大')
  const d = record(JSON.parse(text))
  if (d.protocol !== DUEL_PROTOCOL) throw new Error('对战版本不同，请双方刷新页面')
  if (d.type === 'ready' || d.type === 'forfeit') return { type: d.type }
  if (d.type === 'ping' || d.type === 'pong') return { type: d.type, time: finite(d.time, 0) }
  if (d.type === 'input') return { type: 'input', sequence: integer(d.sequence), round: integer(d.round), intent: cleanIntent(d.intent), offers: d.offers === true }
  if (d.type === 'action') return { type: 'action', sequence: integer(d.sequence), round: integer(d.round), action: cleanAction(d.action) }
  if (d.type !== 'state') throw new Error('未知的消息')
  const state = record(d.state), wins = state.wins, ready = state.ready
  if (typeof state.mode !== 'string' || !Object.hasOwn(DUEL_MODES, state.mode)) throw new Error('对战模式无效')
  integer(state.round); integer(state.countdown, 0, DUEL_RULES.countdown); integer(state.remaining, 0, DUEL_RULES.roundTicks)
  if (!['preparing', 'countdown', 'fighting', 'round-over', 'finished'].includes(String(state.phase)) || ![null, 0, 1, 'draw'].includes(state.winner as never)) throw new Error('回合状态无效')
  if (!Array.isArray(wins) || wins.length !== 2 || !Array.isArray(ready) || ready.length !== 2 || ready.some((x) => typeof x !== 'boolean')) throw new Error('比分无效')
  for (const score of wins) integer(score, 0, DUEL_RULES.winsNeeded)
  if (!Array.isArray(state.plans) || state.plans.length !== 2 || !Array.isArray(state.notices) || state.notices.length !== 2) throw new Error('对战预购无效')
  for (let seat = 0; seat < 2; seat++) {
    const plan = record(state.plans[seat]); if (typeof plan.enabled !== 'boolean') throw new Error('预购开关无效'); validateTargets(plan.targets)
    if (plan.quickMode !== undefined) validateQuickMode(plan.quickMode)
    const value = state.notices[seat]
    if (value !== null) { const notice = record(value); if (typeof notice.id !== 'string' || !CARD_REGISTRY.get(notice.id) || typeof notice.auto !== 'boolean') throw new Error('购买提示无效'); integer(notice.level, 1); finite(notice.price, 0); finite(notice.remainingTicks, 0, 180) }
  }
  const world = restoreWorld(d.world, CARD_REGISTRY, DUEL_ECONOMY, Object.keys(DUEL_ATTRS)), fixed = state.mode === 'fixed'
  if (!world.participants || Object.keys(world.participants).join(',') !== '1,2' || world.actors.get(1)?.team !== 'player' || world.actors.get(2)?.team !== 'enemy' ||
    world.actors.size > 2 + DUEL_RULES.monsterLimit || world.projectiles.length > DUEL_RULES.projectileLimit || world.mines.length > DUEL_RULES.mineLimit || world.purchases.length || world.waves || world.pendingSpawns.length || world.pickups.length > DUEL_RULES.pickupLimit) throw new Error('对战世界无效')
  if (state.mode !== 'resource' && (world.actors.size !== 2 || world.pickups.length)) throw new Error('此模式不刷新资源')
  if ([...world.actors.values()].some((a) => a.id > 2 && a.team !== 'neutral')) throw new Error('怪物阵营无效')
  const base = fixed ? DUEL_ATTRS : DUEL_BUILD_ATTRS
  for (const key of Object.keys(base) as (keyof typeof base)[]) if (world.basePlayerAttrs[key] !== base[key]) throw new Error('初始装备不匹配')
  for (const id of [1, 2]) {
    const actor = world.actors.get(id)!, progress = world.participants[id]!, resolved = resolveAttrs(base, progress.purchases, CARD_REGISTRY)
    if (fixed && (progress.shards || progress.purchases.length)) throw new Error('固定装备不可购买')
    if (actor.damageIframesTicks !== (id === 1 ? undefined : 30)) throw new Error('受伤规则不匹配')
    for (const key of Object.keys(resolved) as (keyof typeof resolved)[]) if (actor.attrs[key] !== resolved[key]) throw new Error('装备与购买记录不匹配')
  }
  return { type: 'state', serial: integer(d.serial), state: state as unknown as DuelState, world: d.world as WorldData }
}
