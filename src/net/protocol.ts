import type { Intent } from '../core/controller'
import { finite, integer, record, restoreWorld, type WorldData } from '../core/serialization'
import { CARD_REGISTRY } from '../content/cards'
import { DEFAULT_ECONOMY } from '../content/economy'
import { DUEL_ATTRS, DUEL_RULES, type DuelState } from '../content/duel'
export const DUEL_PROTOCOL = 1
export const MAX_PACKET_BYTES = 128 * 1024
export const IDLE_INPUT: Intent = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, placeMine: false, skills: [], autoAim: false }
export function createRemoteInput() {
  let sequence = -1, receivedAt = -Infinity, intent: Intent = IDLE_INPUT
  return {
    accept: (packet: Extract<DuelPacket, { type: 'input' }>, round: number, now: number) => {
      if (packet.sequence <= sequence || packet.round !== round) return false
      sequence = packet.sequence; receivedAt = now
      intent = { ...packet.intent, skills: [...new Set([...(intent.skills ?? []), ...(packet.intent.skills ?? [])])], lockTarget: packet.intent.lockTarget === undefined ? intent.lockTarget : packet.intent.lockTarget }; return true
    },
    read: (now: number): Intent => { if (now - receivedAt > DUEL_RULES.inputExpiryMs) return IDLE_INPUT; const value = intent; intent = { ...intent, skills: [], lockTarget: undefined }; return value },
    reset: () => { intent = IDLE_INPUT; receivedAt = -Infinity },
  }
}
export type DuelPacket = { type: 'input'; sequence: number; round: number; intent: Intent } | { type: 'ready' } | { type: 'forfeit' } |
  { type: 'ping' | 'pong'; time: number } | { type: 'state'; serial: number; state: DuelState; world: WorldData }
function direction(value: unknown) {
  const p = record(value), x = finite(p.x, -1, 1), y = finite(p.y, -1, 1), length = Math.max(1, Math.hypot(x, y))
  return { x: x / length, y: y / length }
}
export function cleanIntent(value: unknown): Intent {
  const d = record(value)
  const skills = Array.isArray(d.skills) ? [...new Set(d.skills.slice(0, 8))].filter((x) => x === 0 || x === 1) as number[] : []
  return { move: direction(d.move), aim: d.aim ? direction(d.aim) : undefined, fire: d.fire === true, placeMine: d.placeMine === true,
    skills, autoAim: false, autoPickup: false, lockTarget: d.lockTarget === 1 || d.lockTarget === 2 ? d.lockTarget : d.lockTarget === null ? null : undefined }
}
export function encodePacket(packet: DuelPacket): string { return JSON.stringify({ protocol: DUEL_PROTOCOL, ...packet }) }
export function decodePacket(text: string): DuelPacket {
  if (text.length > MAX_PACKET_BYTES) throw new Error('消息过大')
  const d = record(JSON.parse(text))
  if (d.protocol !== DUEL_PROTOCOL) throw new Error('对战版本不同，请双方刷新页面')
  if (d.type === 'ready' || d.type === 'forfeit') return { type: d.type }
  if (d.type === 'ping' || d.type === 'pong') return { type: d.type, time: finite(d.time, 0) }
  if (d.type === 'input') return { type: 'input', sequence: integer(d.sequence), round: integer(d.round), intent: cleanIntent(d.intent) }
  if (d.type !== 'state') throw new Error('未知的消息')
  const state = record(d.state), wins = state.wins, ready = state.ready
  integer(state.round); integer(state.countdown, 0, 180); integer(state.remaining, 0, 7200)
  if (!['preparing', 'countdown', 'fighting', 'round-over', 'finished'].includes(String(state.phase)) || ![null, 0, 1, 'draw'].includes(state.winner as never)) throw new Error('回合状态无效')
  if (!Array.isArray(wins) || wins.length !== 2 || !Array.isArray(ready) || ready.length !== 2 || ready.some((x) => typeof x !== 'boolean')) throw new Error('比分无效')
  for (const score of wins) integer(score, 0, 2)
  const world = restoreWorld(d.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(DUEL_ATTRS))
  if (world.actors.size !== 2 || !world.actors.has(1) || !world.actors.has(2) || world.projectiles.length > 256 || world.mines.length > 6 || world.purchases.length || world.pendingSpawns.length || world.pickups.length) throw new Error('对战世界无效')
  for (const actor of world.actors.values()) for (const key of Object.keys(DUEL_ATTRS) as (keyof typeof DUEL_ATTRS)[]) if (actor.attrs[key] !== DUEL_ATTRS[key]) throw new Error('标准装备不匹配')
  return { type: 'state', serial: integer(d.serial), state: state as unknown as DuelState, world: d.world as WorldData }
}
