import { resolveDamage } from '../attrs'
import { distance } from '../collision'
import { TICK_RATE } from '../types'
import type { Actor, World } from '../world'
import { tryGetPlayer } from '../world'
import { breakChain, offenseShards, registerKill, takenShards } from './rewards'

const IFRAME_TICKS = Math.round(0.5 * TICK_RATE)

export interface DamageEvent {
  readonly targetId: number
  readonly sourceId: number
  readonly sourceTeam: 'player' | 'enemy'
  readonly raw: number
  readonly penetration: number
  readonly isCore: boolean
}

/**
 * The only place hp, shield and shard rewards change.
 * Order: armor -> iframes -> shield -> hp -> rewards -> death.
 */
export function applyDamage(world: World, event: DamageEvent): void {
  const target = world.actors.get(event.targetId)
  if (!target || !target.alive) return

  // Invulnerability nullifies the hit entirely: no damage, no rewards.
  if (target.iframesTicks > 0) return

  const actual = resolveDamage(event.raw, target.attrs.armor, event.penetration)
  if (actual <= 0) return

  const hpBefore = target.hp
  const absorbed = Math.min(target.shield, actual)
  target.shield -= absorbed
  const toHp = actual - absorbed
  const hpLost = Math.min(hpBefore, toHp)
  const overkill = Math.max(0, toHp - hpBefore)

  target.hp = Math.max(0, target.hp - toHp)

  const player = tryGetPlayer(world)
  const effectiveDamage = absorbed + hpLost

  if (event.sourceTeam === 'player' && player && target.team === 'enemy') {
    world.stats.damageDealt += effectiveDamage
    world.shards += offenseShards(world, target.tier, effectiveDamage, overkill, player)
    world.score += effectiveDamage + overkill * world.economy.overflowRate
  } else if (target.team === 'player') {
    world.stats.damageTaken += event.raw
    world.shards += takenShards(world, event.raw)
    world.score += event.raw * 0.5
    world.playerTookHit = true
    breakChain(world)
  }

  world.effects.push({
    kind: event.isCore ? 'coreHit' : 'hit',
    x: target.pos.x,
    y: target.pos.y,
    radius: 26,
    ttl: 10,
  })

  if (hpLost > 0 && target.team === 'player') {
    target.iframesTicks = IFRAME_TICKS
  }

  if (target.hp <= 0) {
    killActor(world, target, player)
  }
}

function killActor(world: World, target: Actor, player: Actor | undefined): void {
  target.alive = false
  world.effects.push({
    kind: 'death',
    x: target.pos.x,
    y: target.pos.y,
    radius: target.radius * 2,
    ttl: 18,
  })

  if (target.team === 'player') {
    world.gameOver = true
    return
  }

  if (player) registerKill(world, player)
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
    })
    return
  }
}
