import { shieldCap, type AttrSet } from './attrs'
import type { BuyResult, Requirement } from './cards'
import { meetsRequirements, purchaseLevel, resolveAttrs } from './cards'
import type { Actor, World } from './world'
import { getPlayer } from './world'

export type CardAvailability = 'ok' | 'locked' | 'max-level' | 'not-enough-shards'

export interface CardState {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly level: number
  readonly price: number
  readonly availability: CardAvailability
  /** Effect of the next purchase, for tooltips. */
  readonly summary: string | null
  /** Prerequisites as data; the UI decides how to phrase them. */
  readonly requires: readonly Requirement[]
}

/** Read-only view for the upgrade panel. */
export function listCardStates(world: World): CardState[] {
  const player = getPlayer(world)

  return world.registry.all().map((card) => {
    const level = purchaseLevel(world.purchases, card.id)
    const price = card.priceFn(level + 1)
    const maxed = card.maxLevel !== undefined && level >= card.maxLevel
    const unlocked = meetsRequirements(player.attrs, world.purchases, card.requires)

    let availability: CardAvailability = 'ok'
    if (maxed) availability = 'max-level'
    else if (!unlocked) availability = 'locked'
    else if (world.shards < price) availability = 'not-enough-shards'

    return {
      id: card.id,
      name: card.name,
      category: card.category,
      level,
      price,
      availability,
      summary: card.summary ? card.summary(level + 1) : null,
      requires: card.requires ?? [],
    }
  })
}

export function buyCard(world: World, cardId: string): BuyResult {
  const card = world.registry.get(cardId)
  if (!card) return { ok: false, reason: 'unknown-card' }

  const player = getPlayer(world)
  const level = purchaseLevel(world.purchases, cardId)

  if (card.maxLevel !== undefined && level >= card.maxLevel) {
    return { ok: false, reason: 'max-level' }
  }
  if (!meetsRequirements(player.attrs, world.purchases, card.requires)) {
    return { ok: false, reason: 'requirements' }
  }

  const price = card.priceFn(level + 1)
  if (world.shards < price) return { ok: false, reason: 'not-enough-shards' }

  world.shards -= price

  const existing = world.purchases.find((purchase) => purchase.id === cardId)
  if (existing) existing.level += 1
  else world.purchases.push({ id: cardId, level: 1 })

  reapplyAttrs(world, player)
  return { ok: true }
}

/** Re-runs the card pipeline and keeps derived actor values consistent. */
export function reapplyAttrs(world: World, player: Actor): void {
  const next = resolveAttrs(world.basePlayerAttrs, world.purchases, world.registry)
  const hpGain = next.maxHp - player.attrs.maxHp

  player.attrs = next
  player.radius = next.radius
  if (hpGain > 0) player.hp = Math.min(next.maxHp, player.hp + hpGain)

  const cap = shieldCap(next)
  if (player.shield > cap) player.shield = cap
}

export function playerShieldCap(player: Actor): number {
  return shieldCap(player.attrs)
}

export function describeAttrs(attrs: AttrSet): string {
  return `hp ${attrs.maxHp} armor ${attrs.armor} dmg ${attrs.damage}`
}
