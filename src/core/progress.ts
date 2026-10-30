import { reconcileSkills } from './systems/skills'
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
  readonly refund: number | null
  readonly tags: readonly string[]
  readonly priority: number
  readonly saleBlocked: string | null
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
      refund: card.resellable && level > 0 ? saleValue(world, card.id) : null,
      tags: card.tags ?? [],
      priority: card.priority,
      saleBlocked: saleBlocker(world, card.id),
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
  if (existing) {
    existing.paid ??= Array.from({ length: level }, (_, i) => card.priceFn(i + 1))
    existing.paid.push(price)
    existing.level += 1
  } else world.purchases.push({ id: cardId, level: 1, paid: [price] })

  reapplyAttrs(world, player)
  return { ok: true }
}

export function saleValue(world: World, cardId: string): number {
  const purchase = world.purchases.find((item) => item.id === cardId)
  const card = world.registry.get(cardId)
  if (!card?.resellable || !purchase || purchase.level < 1) return 0
  const paid = purchase.paid?.[purchase.level - 1] ?? card.priceFn(purchase.level)
  return Math.max(0, Math.min(paid - 1, Math.floor(paid * 0.6)))
}

function saleBlocker(world: World, cardId: string): string | null {
  const nextLevel = purchaseLevel(world.purchases, cardId) - 1
  const dependent = world.purchases.find((item) => item.id !== cardId && item.level > 0 &&
    world.registry.get(item.id)?.requires?.some((requirement) => requirement.card === cardId && (requirement.level ?? 1) > nextLevel))
  return dependent ? world.registry.get(dependent.id)?.name ?? dependent.id : null
}

export function sellCard(world: World, cardId: string): boolean {
  const card = world.registry.get(cardId)
  const purchase = world.purchases.find((item) => item.id === cardId)
  if (!card?.resellable || !purchase || purchase.level < 1) return false
  const nextLevel = purchase.level - 1
  if (saleBlocker(world, cardId)) return false
  world.shards += saleValue(world, cardId)
  purchase.level = nextLevel
  purchase.paid?.pop()
  if (nextLevel === 0) world.purchases = world.purchases.filter((item) => item !== purchase)
  reapplyAttrs(world, getPlayer(world))
  return true
}

/** Re-runs the card pipeline and keeps derived actor values consistent. */
export function reapplyAttrs(world: World, player: Actor): void {
  const next = resolveAttrs(world.basePlayerAttrs, world.purchases, world.registry)
  const hpGain = next.maxHp - player.attrs.maxHp
  const shieldGain = next.shield - player.attrs.shield

  const previous = player.attrs
  player.attrs = next
  reconcileSkills(player, previous)
  if (next.maxProjectiles > 0) {
    let count = 0
    world.projectiles = world.projectiles.filter((bullet) => bullet.ownerId !== player.id || bullet.team !== player.team || ++count <= next.maxProjectiles)
  }
  player.radius = next.radius
  if (hpGain > 0) player.hp = Math.min(next.maxHp, player.hp + hpGain)
  player.hp = Math.min(player.hp, next.maxHp)

  const cap = shieldCap(next)
  // Buying a shield card has to hand over the shield points it promises.
  if (shieldGain > 0) player.shield += shieldGain
  if (player.shield > cap) player.shield = cap
}

export function playerShieldCap(player: Actor): number {
  return shieldCap(player.attrs)
}

export function describeAttrs(attrs: AttrSet): string {
  return `hp ${attrs.maxHp} armor ${attrs.armor} dmg ${attrs.damage}`
}
