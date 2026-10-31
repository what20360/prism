import { type CardRegistry } from './cards'
import type { AttrSet } from './attrs'
import type { EconomyRates } from './economy'
import type { Actor, World } from './world'

export type WorldData = Omit<World, 'actors' | 'registry' | 'economy'> & { actors: Actor[] }
type RecordData = Record<string, unknown>
export function record(value: unknown): RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据结构不完整')
  return value as RecordData
}
export function finite(value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('数值无效')
  return value
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = finite(value, min, max)
  if (!Number.isSafeInteger(number)) throw new Error('整数无效')
  return number
}
export function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('列表大小无效')
  return value
}
function oneOf(value: unknown, values: readonly unknown[]): void { if (!values.includes(value)) throw new Error('未知的数据类型') }
function bool(value: unknown): void { if (typeof value !== 'boolean') throw new Error('开关状态无效') }
function text(value: unknown, max = 100): void { if (typeof value !== 'string' || value.length > max) throw new Error('文字无效') }
function vector(value: unknown): void { const p = record(value); finite(p.x, -1e9, 1e9); finite(p.y, -1e9, 1e9) }
function rect(value: unknown): void { const p = record(value); vector(p); finite(p.width, 0.001, 1e6); finite(p.height, 0.001, 1e6) }
function safeTree(value: unknown, depth = 0, budget = { count: 0 }): void {
  if (++budget.count > 100000 || depth > 20) throw new Error('数据过大')
  if (typeof value === 'number') finite(value)
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('不支持的数据字段')
    safeTree(child, depth + 1, budget)
  }
}
export function validateAttrs(value: unknown, keys: readonly string[]): AttrSet {
  const attrs = record(value)
  if (Object.keys(attrs).length !== keys.length) throw new Error('属性版本不匹配')
  for (const key of keys) finite(attrs[key])
  if (finite(attrs.maxHp) < 1 || finite(attrs.speed) < 0 || finite(attrs.bulletSpeed) < 0 || finite(attrs.range) < 0 || finite(attrs.radius) <= 0 || finite(attrs.vision) <= 0) throw new Error('属性无效')
  return attrs as unknown as AttrSet
}
function intent(value: unknown): void {
  const data = record(value); vector(data.move)
  if (data.aim !== undefined) vector(data.aim)
  for (const key of ['fire', 'placeMine', 'autoAim', 'autoPickup']) if (data[key] !== undefined) bool(data[key])
  if (data.lockTarget !== undefined && data.lockTarget !== null) integer(data.lockTarget, 1)
  if (data.skill !== undefined) integer(data.skill, 0, 1)
  if (data.skills !== undefined) for (const slot of array(data.skills, 8)) integer(slot, 0, 1)
}
/** Plain, versionable data; injected functions are never serialized. */
export function serializeWorld(world: World, cosmetics = false): WorldData {
  return JSON.parse(JSON.stringify({ ...world, registry: undefined, economy: undefined,
    actors: [...world.actors.values()], effects: cosmetics ? world.effects : [], floaters: cosmetics ? world.floaters : [] })) as WorldData
}
/** Validates untrusted save/network input before attaching any runtime services. */
export function restoreWorld(value: unknown, registry: CardRegistry, economy: EconomyRates, attrKeys: readonly string[]): World {
  safeTree(value)
  const d = record(value), ids = new Set<number>()
  const entity = (value: unknown) => { const a = record(value), id = integer(a.id, 1); if (ids.has(id)) throw new Error('实体编号重复'); ids.add(id); return a }
  const numbers = (r: RecordData, names: string, min = 0) => { for (const key of names.split(' ')) finite(r[key], min) }
  const spawn = (value: unknown) => {
    const s = record(value); vector(s.pos); validateAttrs(s.attrs, attrKeys)
    oneOf(s.tier, ['normal', 'elite', 'boss']); oneOf(s.behavior, ['chase', 'turret', 'boss']); finite(s.contactDamage, 0); bool(s.hasCore)
    if (s.name !== undefined) text(s.name)
    if (s.rewardMultiplier !== undefined) finite(s.rewardMultiplier, 0, 1)
    if (s.damageIframesTicks !== undefined) integer(s.damageIframesTicks, 0, 600)
    return s
  }
  integer(d.tick); integer(d.seed); integer(record(d.rng).state, 0, 0xffffffff)
  const room = record(d.room); oneOf(room.phase, ['idle', 'entered', 'combat', 'cleared', 'exited']); oneOf(room.kind, ['safe', 'combat', 'guard', 'boss'])
  rect(room.bounds); vector(room.entry); for (const wall of array(room.walls, 500)) rect(wall)
  if (room.exit !== null) rect(room.exit)
  validateAttrs(d.basePlayerAttrs, attrKeys)
  const actors = array(d.actors, 2000)
  if (!actors.length) throw new Error('没有玩家数据')
  let playerCount = 0
  for (const value of actors) {
    const a = entity(value); spawn(a); oneOf(a.team, ['player', 'enemy', 'neutral']); if (a.team === 'player') playerCount++
    numbers(a, 'radius hp shield damageFlashTicks fireCooldownTicks phase specialCooldownTicks iframesTicks mineCooldownTicks deflectWindowTicks deflectCooldownTicks outOfCombatTicks rageTicks dashTicks rageCooldownTicks dashCooldownTicks burstRemaining burstTimer')
    finite(a.navTimer); finite(a.aimAngle); finite(a.burstAngle); vector(a.dashDirection); vector(a.navGoal); bool(a.alive); intent(a.intent)
    if (finite(a.hp) > finite(record(a.attrs).maxHp)) throw new Error('生命超过上限')
    for (const key of ['lockTargetId', 'manualLockId']) if (a[key] !== null) integer(a[key], 1)
    const slots = array(a.skillSlots, 2); if (slots.length !== 2) throw new Error('技能槽无效')
    for (const slot of slots) oneOf(slot, [null, 'deflect', 'rage', 'dash'])
    if (slots[0] && slots[0] === slots[1]) throw new Error('技能槽重复')
    for (const point of array(a.navPath, 500)) vector(point)
  }
  if (playerCount !== 1) throw new Error('玩家数量无效')
  for (const s of array(d.pendingSpawns, 2000)) spawn(s)
  if (d.waves !== undefined) {
    const waves = record(d.waves), remaining = array(waves.remaining, 24)
    integer(waves.index, 1, 25); integer(waves.total, 1, 25); integer(waves.countdown, 0, 600); integer(waves.delayTicks, 1, 600)
    if (Number(waves.index) + remaining.length !== waves.total) throw new Error('波次进度无效')
    for (const wave of remaining) { const enemies = array(wave, 200); if (!enemies.length) throw new Error('敌人波次为空'); for (const spec of enemies) spawn(spec) }
  }
  for (const value of array(d.projectiles, 4000)) {
    const p = entity(value); oneOf(p.team, ['player', 'enemy', 'neutral']); integer(p.ownerId, 1); vector(p.pos); vector(p.prevPos); vector(p.vel)
    numbers(p, 'radius damage penetration innerMult travelLeft'); integer(p.pierceLeft)
    for (const key of ['rewardMultiplier', 'rangeBudget', 'pierceSpeedMultiplier', 'pierceRangeGain', 'blastRadius', 'resolvedTick', 'homingTurn', 'cruiseSpeed']) if (p[key] !== undefined) finite(p[key], 0)
    if (p.targetId !== undefined && p.targetId !== null) integer(p.targetId, 1)
    if (p.ricochet !== undefined) bool(p.ricochet)
    for (const id of array(p.hitIds, 2000)) integer(id, 1)
    if (p.trail !== undefined) for (const point of array(p.trail, 16)) vector(point)
    if (p.segments !== undefined) for (const segment of array(p.segments, 64)) { const s = record(segment); vector(s.from); vector(s.to) }
  }
  for (const value of array(d.mines, 1000)) {
    const m = entity(value); oneOf(m.team, ['player', 'enemy', 'neutral']); integer(m.ownerId, 1); vector(m.pos)
    numbers(m, 'bodyRadius triggerRadius blastRadius slowRadius slowMultiplier damage hp')
    if (m.fuseTicks !== null) integer(m.fuseTicks)
    for (const key of ['rewardMultiplier', 'fuseTotalTicks', 'travelLeft', 'fragments']) if (m[key] !== undefined) finite(m[key], 0)
    if (m.ignoreBullets !== undefined) bool(m.ignoreBullets)
    if (m.velocity !== undefined) vector(m.velocity)
  }
  for (const value of array(d.pickups, 1000)) { const p = entity(value); oneOf(p.kind, ['blood', 'shard']); vector(p.pos); finite(p.value, 0); finite(p.ttl, -1) }
  for (const value of array(d.effects, 1000)) { const e = record(value); oneOf(e.kind, ['hit', 'coreHit', 'explosion', 'death', 'deflect', 'reflect', 'revive', 'rage', 'dash', 'pickup']); finite(e.x); finite(e.y); finite(e.radius, 0); finite(e.ttl, 0) }
  for (const value of array(d.floaters, 2000)) { const f = record(value); oneOf(f.kind, ['damage', 'overflow', 'taken', 'shard', 'heal']); numbers(f, 'value ttl'); finite(f.x); finite(f.y); finite(f.driftX) }
  const purchases = (values: unknown) => {
    const purchased = new Set<string>()
    for (const value of array(values, registry.all().length)) {
      const p = record(value); text(p.id); const card = registry.get(p.id as string)
      if (!card || purchased.has(card.id)) throw new Error('未知或重复的卡片')
      purchased.add(card.id); const level = integer(p.level, 1, card.maxLevel)
      if (p.paid !== undefined) for (const price of array(p.paid, Math.min(level, 10000))) finite(price, 0)
    }
  }
  purchases(d.purchases)
  if (d.participants !== undefined) {
    const participants = record(d.participants), keys = Object.keys(participants)
    if (keys.length < 2 || keys.length > 8) throw new Error('参战玩家数量无效')
    for (const id of keys) {
      if (!/^[1-9][0-9]*$/.test(id) || !actors.some((a) => record(a).id === Number(id))) throw new Error('参战玩家无效')
      const p = record(participants[id]); finite(p.shards, 0); integer(p.revivesUsed); purchases(p.purchases)
    }
  }
  if (d.resourceDrops !== undefined) bool(d.resourceDrops)
  if (d.monsterShardDrop !== undefined) finite(d.monsterShardDrop, 0)
  integer(d.nextEntityId, Math.max(...ids) + 1); numbers(d, 'shards score revivesUsed')
  const stats = record(d.stats); numbers(stats, 'kills coreHits chain chainIdleTicks bestChain damageDealt damageTaken')
  for (const key of ['roomCleared', 'playerTookHit', 'exitReached', 'gameOver', 'victory', 'paused']) bool(d[key])
  const clone = JSON.parse(JSON.stringify(d)) as WorldData
  return { ...clone, actors: new Map(clone.actors.map((a) => [a.id, a])), registry, economy }
}
