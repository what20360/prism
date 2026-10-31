import { circleIntersectsRect, distance, resolveSpawnPosition } from '../collision'
import { normalize, clamp } from '../math'
import { findPath, hasLineOfSight } from '../navigation'
import { nextFloat, nextInt } from '../rng'
import { WEAVER_RULES as R } from '../weaverRules'
import { createActor, allocateId, type Actor, type World, type WeaverState } from '../world'
import type { Vec2, Rect } from '../types'
import { emitProjectile } from './weapons'
import { selfDestruct } from './damage'

const still = { x: 0, y: 0 }
const ownedMines = (world: World, queen: Actor) => world.mines.filter((m) => m.ownerId === queen.id && m.nestRole)
const children = (world: World, queen: Actor, role: 'worker' | 'bomber') => [...world.actors.values()].filter((a) => a.alive && a.spider?.ownerId === queen.id && a.spider.role === role)
function core(world: World, queen: Actor): Rect {
  return world.room.design?.core ?? { x: queen.pos.x - 260, y: queen.pos.y - 260, width: 520, height: 520 }
}
function inside(point: Vec2, area: Rect, margin: number): Vec2 { return { x: clamp(point.x, area.x + margin, area.x + area.width - margin), y: clamp(point.y, area.y + margin, area.y + area.height - margin) } }
function jitter(world: World, point: Vec2, radius: number, spread: number): Vec2 {
  return resolveSpawnPosition({ x: point.x + (nextFloat(world.rng) * 2 - 1) * spread, y: point.y + (nextFloat(world.rng) * 2 - 1) * spread }, radius, world.room.walls, world.room.bounds)
}
function patrol(world: World, actor: Actor): Vec2 {
  const points = world.room.design?.patrol ?? [actor.pos]
  return jitter(world, points[nextInt(world.rng, 0, points.length)]!, actor.radius + 4, 48)
}
/** Cached navigation is shared by workers, roaming spiders and pursuing spiders. */
function travel(world: World, actor: Actor, goal: Vec2): Vec2 {
  if (world.room.walls.some((wall) => circleIntersectsRect(actor.pos.x, actor.pos.y, actor.radius + 3, wall))) {
    actor.pos = resolveSpawnPosition(actor.pos, actor.radius + 5, world.room.walls, world.room.bounds); actor.navTimer = 0
  }
  if (hasLineOfSight(actor.pos, goal, world.room.walls, actor.radius + 2)) actor.navPath = [goal]
  else if (actor.navTimer <= 0 || distance(goal, actor.navGoal) > 90) {
    actor.navPath = findPath(world.room, actor.pos, goal, actor.radius + 2); actor.navGoal = { ...goal }; actor.navTimer = 30 + actor.id % 12
  }
  actor.navTimer--
  while (actor.navPath.length > 1 && hasLineOfSight(actor.pos, actor.navPath[1]!, world.room.walls, actor.radius + 2)) actor.navPath.shift()
  while (actor.navPath.length && distance(actor.pos, actor.navPath[0]!) < 12) actor.navPath.shift()
  const next = actor.navPath[0]
  return next ? normalize({ x: next.x - actor.pos.x, y: next.y - actor.pos.y }) : still
}
export function plantNestMine(world: World, queen: Actor, point: Vec2, role: 'queen' | 'worker', attack = false): boolean {
  if (!queen.alive || ownedMines(world, queen).length >= R.mineLimit) return false
  const scale = role === 'queen' ? R.mineScale : 1, radius = R.mineRadius * scale
  const pos = resolveSpawnPosition(point, radius, world.room.walls, world.room.bounds)
  const player = [...world.actors.values()].find((a) => a.team === 'player' && a.alive)
  const heading = player ? normalize({ x: player.pos.x - pos.x, y: player.pos.y - pos.y }) : still
  world.mines.push({ id: allocateId(world), ownerId: queen.id, team: queen.team, rewardMultiplier: queen.rewardMultiplier, nestRole: role, pos,
    bodyRadius: radius, blastRadius: R.mineBlast * scale, triggerRadius: R.mineTrigger * scale, slowRadius: R.mineSlow * scale,
    slowMultiplier: 2.5, damage: queen.attrs.mineDamage, hp: queen.attrs.mineHp, fuseTicks: null, fuseTotalTicks: R.mineFuse,
    velocity: attack ? { x: heading.x * R.attackMineSpeed, y: heading.y * R.attackMineSpeed } : undefined,
    travelLeft: attack && player ? Math.min(R.attackMineRange, distance(player.pos, pos)) : undefined,
    pulseCount: 1, pulsesRemaining: 1, fragments: 0, broodLevel: 0 })
  return true
}
export function spawnNestSpider(world: World, queen: Actor, role: 'worker' | 'bomber', point?: Vec2, goal?: Vec2): Actor | undefined {
  if (children(world, queen, role).length >= (role === 'bomber' ? R.spiderLimit : R.workerLimit)) return undefined
  const worker = role === 'worker', radius = worker ? 25 : 23
  const attrs = { ...queen.attrs, maxHp: Math.max(worker ? 24 : 16, queen.attrs.maxHp * (worker ? 0.018 : 0.012)), radius, armor: queen.attrs.armor * 0.2, block: 0,
    speed: queen.attrs.speed * (worker ? 1.15 : 1.3), damage: queen.attrs.damage * 0.4, fireRate: 0, shield: 0, weapon: 0, multishot: 1,
    bulletSpeed: queen.attrs.bulletSpeed * 0.8, range: 750, bulletSize: 6, homing: 0, ricochet: 0, burstCount: 1, pierce: 1 }
  const actor = createActor(world, { team: queen.team, behavior: worker ? 'silk-worker' : 'silk-bomber', tier: 'normal', name: worker ? '织雷工蛛' : '爆裂幼蛛',
    hasCore: false, contactDamage: 0, rewardMultiplier: queen.rewardMultiplier, attrs, pos: jitter(world, point ?? queen.pos, radius + 4, point ? 24 : 100), attackType: worker ? 'physical' : 'heat' })
  actor.spider = { ownerId: queen.id, role, goal: goal ?? patrol(world, actor), roamTimer: 180, pursuing: false, dashUsed: false, task: worker && goal !== undefined,
    expiresAt: worker ? world.tick + R.workerLifetime : 0 }
  return actor
}
function initialize(world: World, queen: Actor): WeaverState {
  const area = core(world, queen), goal = { x: area.x + area.width / 2, y: area.y + area.height / 2 }
  queen.weaver = { mineStock: R.mineCache, mineRegen: R.mineRegen, spiderStock: R.spiderCache, spiderRegen: R.spiderRegen, spawnTimer: R.summonGap,
    volley: 0, volleyTimer: 0, volleyCooldown: R.volleyCooldown, shotTicks: 0, phaseBurst: false, lostMines: [], goal, moveTimer: 120 }
  for (const anchor of world.room.design?.mineAnchors ?? []) plantNestMine(world, queen, anchor, 'worker')
  const points = world.room.design?.patrol ?? [queen.pos]
  const safe = points.filter((p) => distance(p, world.room.entry) > 360)
  for (let i = 0; i < R.spiderLimit; i++) spawnNestSpider(world, queen, 'bomber', safe[i % Math.max(1, safe.length)] ?? queen.pos)
  return queen.weaver
}
function incoming(world: World, queen: Actor): boolean {
  return world.projectiles.some((p) => {
    if (p.team === queen.team) return false
    const squared = p.vel.x ** 2 + p.vel.y ** 2
    if (squared < 1) return false
    const t = ((queen.pos.x - p.pos.x) * p.vel.x + (queen.pos.y - p.pos.y) * p.vel.y) / squared
    return t >= 0 && t <= 0.35 && Math.hypot(p.pos.x + p.vel.x * t - queen.pos.x, p.pos.y + p.vel.y * t - queen.pos.y) <= queen.radius + p.radius + 12 && hasLineOfSight(p.pos, queen.pos, world.room.walls)
  })
}
export function updateWeaver(world: World, queen: Actor, player: Actor): void {
  const s = queen.weaver ?? initialize(world, queen), area = core(world, queen)
  for (const [id, a] of world.actors) if (!a.alive && a.spider?.ownerId === queen.id) world.actors.delete(id)
  if (s.mineStock >= R.mineCache) s.mineRegen = R.mineRegen
  else if (--s.mineRegen <= 0) { s.mineStock++; s.mineRegen = R.mineRegen }
  if (s.spiderStock >= R.spiderCache) s.spiderRegen = R.spiderRegen
  else if (--s.spiderRegen <= 0) { s.spiderStock++; s.spiderRegen = R.spiderRegen }
  s.spawnTimer = Math.max(0, s.spawnTimer - 1); s.shotTicks = Math.max(0, s.shotTicks - 1)
  if (!s.phaseBurst && queen.hp <= queen.attrs.maxHp / 2) {
    queen.phase = 2; s.phaseBurst = true
    const missing = R.spiderLimit - children(world, queen, 'bomber').length
    for (let i = 0; i < missing; i++) spawnNestSpider(world, queen, 'bomber')
    queen.hp = Math.max(1, queen.hp - missing * queen.attrs.maxHp * R.sacrifice)
    world.effects.push({ kind: 'rage', x: queen.pos.x, y: queen.pos.y, radius: area.width / 2, ttl: 30 })
  }
  if (s.spawnTimer === 0 && s.spiderStock > 0 && children(world, queen, 'bomber').length < R.spiderLimit) {
    if (spawnNestSpider(world, queen, 'bomber')) { s.spiderStock--; s.spawnTimer = R.summonGap }
  }
  const workers = children(world, queen, 'worker'), reserved = workers.filter((a) => a.spider!.task).length
  if (s.lostMines.length && s.mineStock === R.mineCache && ownedMines(world, queen).length + reserved < R.mineLimit && workers.length < R.workerLimit) {
    const site = s.lostMines.shift()!, goal = jitter(world, site, R.mineRadius + 4, R.mineJitter)
    if (spawnNestSpider(world, queen, 'worker', undefined, goal)) s.mineStock--
  }
  const visible = hasLineOfSight(queen.pos, player.pos, world.room.walls), separation = distance(queen.pos, player.pos)
  if (queen.mineCooldownTicks <= 0 && s.mineStock > 0 && ownedMines(world, queen).length + children(world, queen, 'worker').filter((a) => a.spider!.task).length < R.mineLimit) {
    const attacking = s.phaseBurst && visible && separation <= R.attackMineRange
    if ((attacking || !s.phaseBurst && incoming(world, queen)) && plantNestMine(world, queen, queen.pos, 'queen', attacking)) {
      s.mineStock--; queen.mineCooldownTicks = R.mineCooldown
    }
  }
  const aim = normalize({ x: player.pos.x - queen.pos.x, y: player.pos.y - queen.pos.y }); queen.aimAngle = Math.atan2(aim.y, aim.x)
  let move = still
  s.volleyCooldown = Math.max(0, s.volleyCooldown - 1)
  if (s.volley === 0) {
    if (s.volleyCooldown === 0 && visible) { s.volley = 1; s.volleyTimer = R.firstWindup; s.volleyCooldown = R.volleyCooldown }
    if (--s.moveTimer <= 0) { s.goal = inside(jitter(world, queen.pos, queen.radius, 150), area, queen.radius + 8); s.moveTimer = 120 + nextInt(world.rng, 0, 150) }
    if (visible && s.volleyCooldown < 120) s.goal = inside(player.pos, area, queen.radius + 8)
    if (distance(s.goal, queen.pos) > 18) move = normalize({ x: s.goal.x - queen.pos.x, y: s.goal.y - queen.pos.y })
  }
  if (s.volley > 0) {
    if (s.volleyTimer > R.volleyWindup) {
      const direction = s.volley < 3 ? aim : { x: -aim.x, y: -aim.y }
      s.goal = inside({ x: queen.pos.x + direction.x * 180, y: queen.pos.y + direction.y * 180 }, area, queen.radius + 8)
      if ((s.volley === 3 || separation > 155) && distance(s.goal, queen.pos) > 8) move = normalize({ x: s.goal.x - queen.pos.x, y: s.goal.y - queen.pos.y })
    } else move = still
    if (--s.volleyTimer <= 0) {
      move = still
      const shots = Math.min(31, Math.max(3, Math.floor(queen.attrs.multishot)))
      for (let i = 0; i < shots; i++) emitProjectile(world, queen, queen.aimAngle + (i - (shots - 1) / 2) * R.fanStep)
      s.shotTicks = 10
      if (s.volley === 3) { s.volley = 0; s.volleyTimer = 0 }
      else { s.volley++; s.volleyTimer = R.volleyGap }
    }
  }
  queen.intent = { move, aim, fire: false }
}
export function updateNestSpider(world: World, actor: Actor, player: Actor): void {
  const s = actor.spider, queen = s ? world.actors.get(s.ownerId) : undefined
  if (!s || !queen?.alive) { actor.alive = false; actor.hp = 0; return }
  if (s.role === 'worker') {
    if (world.tick >= s.expiresAt) {
      if (s.task && queen.weaver && queen.weaver.lostMines.length < R.mineLimit) queen.weaver.lostMines.push({ ...s.goal })
      actor.alive = false; actor.hp = 0; return
    }
    if (s.task && distance(actor.pos, s.goal) < 30 && plantNestMine(world, queen, s.goal, 'worker')) { s.task = false; s.roamTimer = 0 }
  } else {
    const visible = hasLineOfSight(actor.pos, player.pos, world.room.walls), separation = distance(actor.pos, player.pos)
    if (visible && separation < R.acquireRange) s.pursuing = true
    if (s.pursuing) {
      s.goal = { ...player.pos }
      if (!s.dashUsed && (separation < R.dashRange || actor.hp < actor.attrs.maxHp / 2)) {
        const direction = travel(world, actor, s.goal)
        if (Math.hypot(direction.x, direction.y) > 0) { actor.dashTicks = R.dashTicks; actor.dashDirection = direction; s.dashUsed = true }
      }
      if (actor.bombTicks === undefined && visible && separation < R.spiderTrigger) { actor.bombTicks = R.spiderFuse; actor.dashTicks = 0 }
    }
    if (actor.bombTicks !== undefined) {
      actor.intent = { move: still, fire: false }
      if (--actor.bombTicks <= 0) selfDestruct(world, actor)
      return
    }
  }
  if (!s.task && !s.pursuing && (--s.roamTimer <= 0 || distance(actor.pos, s.goal) < 30)) { s.goal = patrol(world, actor); s.roamTimer = 300 + nextInt(world.rng, 0, 180) }
  actor.intent = { move: travel(world, actor, s.goal), aim: normalize({ x: player.pos.x - actor.pos.x, y: player.pos.y - actor.pos.y }), fire: false }
}
