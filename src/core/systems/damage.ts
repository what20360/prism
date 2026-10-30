import { combatAttrs } from '../combat'
import { nextFloat } from '../rng'
import { allocateId } from '../world'
import { resolveDamage, shieldCap } from '../attrs'
import { distance } from '../collision'
import { TICK_RATE } from '../types'
import { DROP_RULES } from '../rules'
import type { EffectKind, Actor, FloaterKind, World } from '../world'
import { tryGetPlayer } from '../world'
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
  readonly sourceTeam: 'player' | 'enemy'
  readonly raw: number
  readonly penetration: number
  readonly isCore: boolean
  readonly kind?: 'bullet' | 'mine' | 'contact'
  readonly rewardMultiplier?: number
}

/**
 * The only place hp, shield and shard rewards change.
 * Order: armor -> iframes -> shield -> hp -> rewards -> lifesteal -> death.
 */
export function applyDamage(world: World, event: DamageEvent): void {
  const target = world.actors.get(event.targetId)
  if (!target || !target.alive) return

  // Invulnerability nullifies the hit entirely: no damage, no rewards.
  if (target.iframesTicks > 0) return

  const actual = resolveDamage(event.raw, combatAttrs(target).armor, event.penetration)
  if (actual <= 0) return

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

  if (event.sourceTeam === 'player' && player && target.team === 'enemy') {
    world.stats.damageDealt += effectiveDamage
    const reward = target.rewardMultiplier ?? 1
    const gained = offenseShards(world, target.tier, effectiveDamage, overkill, player) * player.attrs.shardGain * reward
    world.shards += gained
    world.score += effectiveDamage + overkill * world.economy.overflowRate
    applyLifesteal(player, effectiveDamage)
    const chance = event.kind === 'mine' ? player.attrs.mineShardChance : event.kind === 'bullet' ? player.attrs.bloodOrbChance : 0
    if (effectiveDamage > 0 && chance > 0 && world.pickups.length < 100 && nextFloat(world.rng) < chance) {
      world.pickups.push({ id: allocateId(world), kind: event.kind === 'mine' ? 'shard' : 'blood', pos: { ...target.pos },
        value: event.kind === 'mine' ? DROP_RULES.shardValue * player.attrs.shardGain * reward : Math.max(DROP_RULES.bloodMinimum, player.attrs.maxHp * DROP_RULES.bloodHpFraction), ttl: 30 * TICK_RATE })
    }
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
    killActor(world, target, player)
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
  if (target.team === 'player') {
    const revivesLeft = Math.max(0, Math.floor(target.attrs.revives) - world.revivesUsed)
    if (revivesLeft > 0) {
      world.revivesUsed += 1
      target.hp = Math.max(1, Math.round(target.attrs.maxHp * 0.5))
      target.iframesTicks = REVIVE_IFRAME_TICKS
      target.shield = 0
      clearNearbyProjectiles(world, target.pos.x, target.pos.y, REVIVE_CLEAR_RADIUS)
      breakChain(world)
      pushEffect(world, 'revive', target.pos.x, target.pos.y, REVIVE_CLEAR_RADIUS)
      return
    }

    target.alive = false
    world.gameOver = true
    pushEffect(world, 'death', target.pos.x, target.pos.y, target.radius * 2)
    return
  }

  target.alive = false
  pushEffect(world, 'death', target.pos.x, target.pos.y, target.radius * 2)
  if (player) registerKill(world, player)
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
      raw: actor.contactDamage,
      penetration: actor.attrs.penetration,
      isCore: false,
      rewardMultiplier: actor.rewardMultiplier,
    })
    return
  }
}
