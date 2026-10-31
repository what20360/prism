import { grantCoopShards, COOP_REVIVE_TICKS } from '../coop'
import { combatAttrs } from '../combat'
import { resolveDamage, shieldCap } from '../attrs'
import { distance } from '../collision'
import { TICK_RATE } from '../types'
import { ARSENAL_RULES, KILL_LOOT_RULES } from '../rules'
import { killDropProbability, rollLootAmount, spawnLoot } from '../loot'
import { hasLineOfSight } from '../navigation'
import { releaseDeathBurst } from './hostileBursts'
import { WEAVER_RULES } from '../weaverRules'
import type { DamageType, EffectKind, Actor, FloaterKind, World } from '../world'
import { tryGetPlayer, progressOf } from '../world'
import type { Team } from '../types'
import { breakChain, offenseShards, registerKill, takenShards } from './rewards'

const IFRAME_TICKS = Math.round(0.5 * TICK_RATE)
const REVIVE_IFRAME_TICKS = Math.round(2 * TICK_RATE)
const REVIVE_CLEAR_RADIUS = 260
/** How long a damaged enemy keeps showing its stat card. */
const DAMAGE_FLASH_TICKS = 90
const FLOATER_TTL = 46

export interface DamageEvent {
  readonly targetId: number
  readonly sourceId: number
  readonly sourceTeam: Team
  readonly raw: number
  readonly penetration: number
  readonly isCore: boolean
  readonly kind?: 'bullet' | 'mine' | 'contact' | 'electric' | 'laser' | 'status'
  readonly damageType?: DamageType
  readonly rewardMultiplier?: number
}

/**
 * The only place hp, shield and shard rewards change.
 * Order: invulnerability -> block -> armor -> resistance -> shield -> hp -> rewards -> death/status.
 */
export function applyDamage(world: World, event: DamageEvent): void {
  const target = world.actors.get(event.targetId)
  if (!target || !target.alive || world.coop && target.team === event.sourceTeam) return

  // Invulnerability nullifies the hit entirely: no damage, no rewards.
  if (target.iframesTicks > 0) return

  const attrs = combatAttrs(target), type = event.damageType ?? 'physical'
  const resistance = type === 'electric' ? attrs.electricResist : type === 'heat' ? attrs.heatResist : attrs.physicalResist
  const actual = resolveDamage(event.raw, attrs.armor, event.penetration, attrs.block, resistance)
  if (actual <= 0) { target.damageFlashTicks = DAMAGE_FLASH_TICKS; pushEffect(world, 'block', target.pos.x, target.pos.y, target.radius + 8); return }

  const hpBefore = target.hp
  const absorbed = Math.min(target.shield, actual)
  target.shield -= absorbed
  const toHp = actual - absorbed
  const hpLost = Math.min(hpBefore, toHp)
  const overkill = Math.max(0, toHp - hpBefore)

  target.hp = Math.max(0, target.hp - toHp)
  target.outOfCombatTicks = 0
  target.damageFlashTicks = DAMAGE_FLASH_TICKS

  const player = tryGetPlayer(world)
  const effectiveDamage = absorbed + hpLost

  if (world.coop) {
    const source = world.actors.get(event.sourceId)
    if (source && world.participants?.[source.id] && target.team !== source.team) {
      target.contributions ??= {}; target.contributions[source.id] = (target.contributions[source.id] ?? 0) + effectiveDamage
      world.stats.damageDealt += effectiveDamage
      grantCoopShards(world, offenseShards(world,target.tier,effectiveDamage,overkill,source)*(target.rewardMultiplier??1),source.id,{[source.id]:effectiveDamage})
      if(source.alive) applyLifesteal(source,effectiveDamage)
    } else if (world.participants?.[target.id]) { world.stats.damageTaken += effectiveDamage; grantCoopShards(world,takenShards(world,event.raw),target.id,{[target.id]:1}) }
    pushFloater(world,'damage',effectiveDamage,target.pos.x,target.pos.y)
  } else if (world.participants) {
    const source = world.actors.get(event.sourceId)
    if (source?.alive && world.participants[source.id] && source.team !== target.team) {
      applyLifesteal(source, effectiveDamage)

    }
    pushFloater(world, 'damage', effectiveDamage, target.pos.x, target.pos.y)
  } else if (event.sourceTeam === 'player' && player && target.team === 'enemy') {
    world.stats.damageDealt += effectiveDamage
    const reward = target.rewardMultiplier ?? 1
    const gained = offenseShards(world, target.tier, effectiveDamage, overkill, player) * player.attrs.shardGain * reward
    world.shards += gained
    world.score += effectiveDamage + overkill * world.economy.overflowRate
    applyLifesteal(player, effectiveDamage)

    pushFloater(world, 'damage', effectiveDamage, target.pos.x, target.pos.y)
    if (overkill > 0) pushFloater(world, 'overflow', overkill, target.pos.x, target.pos.y)
    if (gained > 0.05) pushFloater(world, 'shard', gained, target.pos.x, target.pos.y)
  } else if (target.team === 'player') {
    world.stats.damageTaken += event.raw
    const sourceReward = event.rewardMultiplier ?? world.actors.get(event.sourceId)?.rewardMultiplier ?? 1
    const gained = takenShards(world, event.raw) * target.attrs.shardGain * sourceReward
    world.shards += gained
    world.score += event.raw * 0.5
    world.playerTookHit = true
    breakChain(world)
    pushFloater(world, 'taken', effectiveDamage, target.pos.x, target.pos.y)
    if (gained > 0.05) pushFloater(world, 'shard', gained, target.pos.x, target.pos.y)
  }

  pushEffect(world, event.isCore ? 'coreHit' : 'hit', target.pos.x, target.pos.y, 26)

  if (hpLost > 0) {
    target.iframesTicks = target.damageIframesTicks ?? (target.team === 'player' ? IFRAME_TICKS : 0)
  }

  if (target.hp <= 0) {
    const killer = world.actors.get(event.sourceId)
    if (killer && killer.team !== target.team && !world.participants?.[target.id] && target.team !== 'player') dropKillLoot(world, target, killer, overkill)
    killActor(world, target, killer?.team === 'player' ? killer : undefined)
  } else if (event.kind !== 'status') {
    if (type === 'electric') target.shockTicks = ARSENAL_RULES.shockTicks
    if (type === 'heat') {
      const raw = event.raw * ARSENAL_RULES.burnDamage, old = target.burn
      target.burn = { sourceId: old && old.raw > raw ? old.sourceId : event.sourceId, sourceTeam: old && old.raw > raw ? old.sourceTeam : event.sourceTeam,
        raw: Math.max(raw, old?.raw ?? 0), remaining: ARSENAL_RULES.burnHits, timer: old?.timer ?? ARSENAL_RULES.burnInterval, rewardMultiplier: event.rewardMultiplier }
    }
  }
}

/** Lifesteal heals, shield steal fills the shield up to its cap. */
function applyLifesteal(player: Actor, damage: number): void {
  if (damage <= 0) return

  const attrs = combatAttrs(player)
  if (attrs.lifesteal > 0) {
    player.hp = Math.min(player.attrs.maxHp, player.hp + damage * attrs.lifesteal)
  }

  const shieldGain = damage * player.attrs.shieldSteal
  if (shieldGain > 0) {
    player.shield = Math.min(shieldCap(player.attrs), player.shield + shieldGain)
  }
}

function killActor(world: World, target: Actor, player: Actor | undefined): void {
  if (world.coop && world.participants?.[target.id]) { target.alive=false;target.shield=0;target.burn=undefined;world.coop.members.find((m)=>m.id===target.id)!.reviveTicks=COOP_REVIVE_TICKS;pushEffect(world,'death',target.pos.x,target.pos.y,target.radius*2);return }
  if (world.participants?.[target.id] || (!world.participants && target.team === 'player')) {
    const progress = progressOf(world, world.participants ? target.id : undefined)
    const revivesLeft = Math.max(0, Math.floor(target.attrs.revives) - progress.revivesUsed)
    if (revivesLeft > 0) {
      progress.revivesUsed += 1
      target.hp = Math.max(1, Math.round(target.attrs.maxHp * 0.5))
      target.iframesTicks = REVIVE_IFRAME_TICKS
      target.shield = 0
      clearNearbyProjectiles(world, target.pos.x, target.pos.y, REVIVE_CLEAR_RADIUS)
      breakChain(world)
      pushEffect(world, 'revive', target.pos.x, target.pos.y, REVIVE_CLEAR_RADIUS)
      return
    }

    target.alive = false
    if (!world.participants) world.gameOver = true
    pushEffect(world, 'death', target.pos.x, target.pos.y, target.radius * 2)
    return
  }

  target.alive = false
  target.burn = undefined
  if (target.spider?.role === 'worker' && target.spider.task) {
    const queen = world.actors.get(target.spider.ownerId)
    if (queen?.alive && queen.weaver && queen.weaver.lostMines.length < WEAVER_RULES.mineLimit) queen.weaver.lostMines.push({ ...target.spider.goal })
  }
  releaseDeathBurst(world, target)
  pushEffect(world, 'death', target.pos.x, target.pos.y, target.radius * 2)
  if (world.coop && player || !world.participants && player) registerKill(world, player)
}

/** Roll only on a true kill; overkill is post-block/armor/resistance/shield. */
function dropKillLoot(world: World, target: Actor, killer: Actor, overkill: number): void {
  if (world.participants ? !world.resourceDrops || !world.participants[killer.id] : killer.team !== 'player') return
  const drops = [
    { kind: 'shard' as const, level: killer.attrs.mineShardChance, multiplier: target.rewardMultiplier ?? 1 },
    { kind: 'blood' as const, level: killer.attrs.bloodOrbChance, multiplier: 1 },
  ]
  for (const drop of drops) {
    const probability = killDropProbability(drop.level, overkill, target.attrs.maxHp) * drop.multiplier
    const base = drop.kind === 'shard' && world.participants ? world.monsterShardDrop ?? 0 : 0
    const amount = Math.min(KILL_LOOT_RULES.limit, base + rollLootAmount(world.rng, probability))
    const firstId = world.nextEntityId
    if (amount > 0) spawnLoot(world, drop.kind, { x: target.pos.x, y: target.pos.y + (drop.kind === 'shard' ? -20 : 20) }, amount, 30 * TICK_RATE)
    if (world.coop) for (const p of world.pickups) if (p.id >= firstId) { p.ownerId=killer.id;p.contributions={...target.contributions} }
  }
}
/** Self destruction is not a player kill and cannot pay kill-card rewards. */
export function selfDestruct(world: World, actor: Actor): void {
  if (!actor.alive) return
  actor.hp = 0; actor.alive = false; actor.burn = undefined
  const radius = actor.behavior === 'silk-bomber' ? WEAVER_RULES.spiderBlast : ARSENAL_RULES.bombRadius
  releaseDeathBurst(world, actor)
  pushEffect(world, 'explosion', actor.pos.x, actor.pos.y, radius)
  for (const target of world.actors.values()) {
    if (!target.alive || target.team === actor.team || !(world.participants ? world.participants[target.id] : target.team === 'player') || distance(actor.pos, target.pos) > radius + target.radius || !hasLineOfSight(actor.pos, target.pos, world.room.walls)) continue
    applyDamage(world, { targetId: target.id, sourceId: actor.id, sourceTeam: actor.team, raw: actor.attrs.damage * (actor.behavior === 'silk-bomber' ? WEAVER_RULES.spiderDamage : ARSENAL_RULES.bombDamage),
      penetration: actor.attrs.penetration, isCore: false, kind: 'contact', damageType: actor.attackType ?? 'heat', rewardMultiplier: actor.rewardMultiplier })
  }
}

function clearNearbyProjectiles(world: World, x: number, y: number, radius: number): void {
  world.projectiles = world.projectiles.filter(
    (projectile) => distance(projectile.pos, { x, y }) > radius,
  )
}

function pushEffect(world: World, kind: EffectKind, x: number, y: number, radius: number): void {
  world.effects.push({ kind, x, y, radius, ttl: 18 })
}

/** Combat text is cosmetic: it lives in `world.floaters` and never feeds the hash. */
function pushFloater(world: World, kind: FloaterKind, value: number, x: number, y: number): void {
  // Stack the kinds vertically so a hit does not print damage, overflow and
  // shards on top of each other.
  const lift: Record<FloaterKind, number> = {
    damage: 26,
    overflow: 56,
    shard: 84,
    taken: -56,
    heal: -84,
  }
  const jitter = ((world.floaters.length % 3) - 1) * 18

  world.floaters.push({
    kind,
    value,
    x: x + jitter,
    y: y - lift[kind],
    ttl: FLOATER_TTL,
    driftX: jitter * 0.08,
  })
}

/** Melee contact damage from chasing enemies, gated by the player's iframes. */
export function resolveContactDamage(world: World): void {
  if (world.participants) {
    for (const id of Object.keys(world.participants)) {
      const target = world.actors.get(Number(id))!
      if (!target.alive || target.iframesTicks > 0 || (target.contactCooldownTicks ?? 0) > 0) continue
      for (const source of world.actors.values()) {
        if (!source.alive || source.team === target.team || source.contactDamage <= 0 || distance(source.pos, target.pos) > source.radius + target.radius) continue
        applyDamage(world, { targetId: target.id, sourceId: source.id, sourceTeam: source.team, raw: source.contactDamage, penetration: source.attrs.penetration, isCore: false, damageType: source.attackType })
        target.contactCooldownTicks = IFRAME_TICKS
        break
      }
    }
    return
  }
  const player = tryGetPlayer(world)
  if (!player || player.iframesTicks > 0) return

  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team !== 'enemy' || actor.contactDamage <= 0) continue
    const reach = actor.radius + player.radius
    if (distance(actor.pos, player.pos) > reach) continue

    applyDamage(world, {
      targetId: player.id,
      sourceId: actor.id,
      sourceTeam: 'enemy',
      raw: actor.contactDamage, damageType: actor.attackType,
      penetration: actor.attrs.penetration,
      isCore: false,
      rewardMultiplier: actor.rewardMultiplier,
    })
    return
  }
}
