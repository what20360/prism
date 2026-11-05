import { reconcileSkills } from './systems/skills'
import { shieldCap, type AttrSet } from './attrs'
import { enforceMineLimits } from './mineLimits'
import type { BuyResult, Requirement, CardRegistry, Purchase } from './cards'
import { isFiniteBuild, meetsRequirements, purchaseLevel, resolveAttrs } from './cards'
import { CARD_ECONOMY } from './rules'
import type { Actor, World } from './world'
import { getPlayer, progressOf } from './world'

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
  readonly blockedReason?: string | null
  readonly purpose?: string
}

/** Read-only view for the upgrade panel. */
export function listCardStates(world: World, actorId?: number): CardState[] {
  const player = actorId === undefined ? getPlayer(world) : world.actors.get(actorId)!
  const progress = progressOf(world, actorId)

  return listBuildCards(world.registry, player.attrs, progress, world.cardRestrictions)
}

export function listBuildCards(registry: CardRegistry, attrs: AttrSet, progress: { shards: number; purchases: readonly Purchase[] }, restrictions?: Record<string, string>, refundRatio: number = CARD_ECONOMY.refundRatio): CardState[] {
  return registry.all().map((card) => {
    const level = purchaseLevel(progress.purchases, card.id)
    const price = card.priceFn(level + 1)
    const maxed = card.maxLevel !== undefined && level >= card.maxLevel
    const unlocked = meetsRequirements(attrs, progress.purchases, card.requires)
    const blockedReason = restrictions?.[card.id] ?? card.unavailable?.(attrs) ?? null

    let availability: CardAvailability = 'ok'
    if (maxed) availability = 'max-level'
    else if (!unlocked || blockedReason) availability = 'locked'
    else if (!Number.isFinite(price) || progress.shards < price) availability = 'not-enough-shards'

    return {
      id: card.id,
      name: card.name,
      category: card.category,
      level,
      price,
      availability,
      summary: card.summary ? card.summary(maxed ? level : level + 1) : null,
      requires: card.requires ?? [],
      refund: card.resellable && level > 0 ? buildSaleValue(registry, progress.purchases, card.id, refundRatio) : null,
      tags: card.tags ?? [],
      priority: card.priority,
      saleBlocked: null,
      blockedReason, purpose: card.purpose,
    }
  })
}

export function buyCard(world: World, cardId: string, actorId?: number): BuyResult {
  const card = world.registry.get(cardId)
  if (!card) return { ok: false, reason: 'unknown-card' }

  const player = actorId === undefined ? getPlayer(world) : world.actors.get(actorId)!
  const progress = progressOf(world, actorId)
  const level = purchaseLevel(progress.purchases, cardId)

  if (card.maxLevel !== undefined && level >= card.maxLevel) {
    return { ok: false, reason: 'max-level' }
  }
  if (world.cardRestrictions?.[cardId] || card.unavailable?.(player.attrs) || !meetsRequirements(player.attrs, progress.purchases, card.requires)) {
    return { ok: false, reason: 'requirements' }
  }

  const price = card.priceFn(level + 1)
  if (!Number.isSafeInteger(level + 1) || !Number.isFinite(price) || price < 0) return { ok: false, reason: 'numeric-range' }
  if (progress.shards < price) return { ok: false, reason: 'not-enough-shards' }
  const proposed = [...progress.purchases.filter((purchase) => purchase.id !== cardId), { id: cardId, level: level + 1 }]
  if (!isFiniteBuild(resolveAttrs(world.basePlayerAttrs, proposed, world.registry))) return { ok: false, reason: 'numeric-range' }

  progress.shards -= price

  const existing = progress.purchases.find((purchase) => purchase.id === cardId)
  if (existing) {
    existing.paid ??= Array.from({ length: level }, (_, i) => card.priceFn(i + 1))
    existing.paid.push(price)
    existing.level += 1
  } else progress.purchases.push({ id: cardId, level: 1, paid: [price] })

  reapplyAttrs(world, player, actorId)
  return { ok: true }
}

export function saleValue(world: World, cardId: string, actorId?: number, refundRatio: number = CARD_ECONOMY.refundRatio): number {
  return buildSaleValue(world.registry, progressOf(world, actorId).purchases, cardId, refundRatio)
}
function buildSaleValue(registry: CardRegistry, purchases: readonly Purchase[], cardId: string, refundRatio: number): number {
  const purchase = purchases.find((item) => item.id === cardId)
  const card = registry.get(cardId)
  if (!card?.resellable || !purchase || purchase.level < 1) return 0
  const paid = purchase.paid?.[purchase.level - 1] ?? card.priceFn(purchase.level)
  return Number.isFinite(paid) ? refundRatio === 1 ? Math.max(0, paid) : Math.max(0, Math.min(paid - 1, Math.floor(paid * CARD_ECONOMY.refundRatio))) : 0
}

export function sellCard(world: World, cardId: string, actorId?: number, refundRatio: number = CARD_ECONOMY.refundRatio): boolean {
  const progress = progressOf(world, actorId)
  const card = world.registry.get(cardId)
  const purchase = progress.purchases.find((item) => item.id === cardId)
  if (!card?.resellable || !purchase || purchase.level < 1) return false
  const nextLevel = purchase.level - 1
  progress.shards += saleValue(world, cardId, actorId, refundRatio)
  purchase.level = nextLevel
  purchase.paid?.pop()
  if (nextLevel === 0) progress.purchases = progress.purchases.filter((item) => item !== purchase)
  reapplyAttrs(world, actorId === undefined ? getPlayer(world) : world.actors.get(actorId)!, actorId)
  return true
}

/** Re-runs the card pipeline and keeps derived actor values consistent. */
export function reapplyAttrs(world: World, player: Actor, actorId?: number): void {
  const next = resolveAttrs(world.basePlayerAttrs, progressOf(world, actorId).purchases, world.registry)
  const hpGain = next.maxHp - player.attrs.maxHp

  const previous = player.attrs
  player.attrs = next
  enforceMineLimits(world, player)
  if (previous.weapon !== next.weapon) {
    if (player.burstRemaining > 0 || (player.laserTicks ?? 0) > 0) player.fireCooldownTicks = Math.max(player.fireCooldownTicks, Math.max(1, Math.round(60 / Math.max(0.001, previous.fireRate))))
    player.laserTicks = 0; player.laserTimer = 0; player.burstRemaining = 0; player.burstTimer = 0
  }
  if (previous.maxProjectiles !== 1 && next.maxProjectiles === 1) { player.laserTicks = 0; player.laserTimer = 0 }
  reconcileSkills(player, previous)
  if (next.maxProjectiles > 0) {
    if (next.maxProjectiles === 1) { player.burstRemaining = 0; player.burstTimer = 0 }
    let count = 0
    world.projectiles = world.projectiles.filter((bullet) => bullet.ownerId !== player.id || bullet.team !== player.team || ++count <= next.maxProjectiles)
  }
  player.radius = next.radius
  if (hpGain > 0) player.hp = Math.min(next.maxHp, player.hp + hpGain)
  player.hp = Math.min(player.hp, next.maxHp)

  const cap = shieldCap(next)
  if (player.shieldDisabledTicks) player.shield = 0
  if (player.shield > cap) player.shield = cap
}

export function playerShieldCap(player: Actor): number {
  return shieldCap(player.attrs)
}

export function describeAttrs(attrs: AttrSet): string {
  return `hp ${attrs.maxHp} armor ${attrs.armor} dmg ${attrs.damage}`
}
