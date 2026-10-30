import type { AttrKey, AttrSet } from './attrs'

export type CardCategory =
  | 'gun'
  | 'mine'
  | 'defense'
  | 'recovery'
  | 'mobility'
  | 'skill'
  | 'special'

/**
 * Prerequisites are data, never code branches: either an attribute threshold
 * or another card at a given level.
 */
export interface Requirement {
  readonly attr?: AttrKey
  readonly min?: number
  readonly card?: string
  readonly level?: number
}

/**
 * A card is a price function plus an effect function.
 * `priceFn` depends only on the purchase count (docs/requirements.md 5.3.1);
 * `effectFn` is pure and returns a new attribute set. `summary` describes the
 * same effect in words so the upgrade panel never has to guess.
 */
export interface Card {
  readonly id: string
  readonly name: string
  readonly category: CardCategory
  readonly priority: number
  readonly priceFn: (level: number) => number
  readonly effectFn: (level: number, attrs: AttrSet) => AttrSet
  readonly summary?: (level: number) => string
  readonly requires?: readonly Requirement[]
  readonly maxLevel?: number
  readonly resellable?: boolean
  readonly tags?: readonly string[]
}

export interface Purchase {
  readonly id: string
  level: number
  paid?: number[]
}

export interface CardRegistry {
  get(id: string): Card | undefined
  all(): readonly Card[]
}

export function createCardRegistry(cards: readonly Card[]): CardRegistry {
  const map = new Map<string, Card>()
  for (const card of cards) map.set(card.id, card)
  return {
    get: (id) => map.get(id),
    all: () => cards,
  }
}

export function purchaseLevel(purchases: readonly Purchase[], id: string): number {
  for (const purchase of purchases) {
    if (purchase.id === id) return purchase.level
  }
  return 0
}

/**
 * Attribute pipeline (docs/architecture.md 5.2):
 * base -> cards sorted by (priority, id) -> final attrs.
 */
export function resolveAttrs(
  base: AttrSet,
  purchases: readonly Purchase[],
  registry: CardRegistry,
): AttrSet {
  const ordered = [...purchases]
    .filter((purchase) => purchase.level > 0)
    .sort((a, b) => {
      const cardA = registry.get(a.id)
      const cardB = registry.get(b.id)
      const priorityA = cardA ? cardA.priority : 0
      const priorityB = cardB ? cardB.priority : 0
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  let attrs = { ...base }
  for (const purchase of ordered) {
    const card = registry.get(purchase.id)
    if (!card) continue
    attrs = card.effectFn(purchase.level, attrs)
  }
  return attrs
}

export function meetsRequirements(
  attrs: AttrSet,
  purchases: readonly Purchase[],
  requires: readonly Requirement[] | undefined,
): boolean {
  if (!requires) return true

  for (const requirement of requires) {
    if (requirement.attr !== undefined) {
      const value = attrs[requirement.attr]
      if (typeof value !== 'number' || value < (requirement.min ?? 0)) return false
    }
    if (requirement.card !== undefined) {
      if (purchaseLevel(purchases, requirement.card) < (requirement.level ?? 1)) return false
    }
  }
  return true
}

/** Numerical validity is independent of game-design level caps. */
export function isFiniteBuild(attrs: AttrSet): boolean {
  return Object.values(attrs).every(Number.isFinite) && attrs.maxHp >= 1 && attrs.bulletSpeed > 0 && attrs.range > 0 && attrs.speed >= 0
}

export type BuyFailure = 'unknown-card' | 'max-level' | 'requirements' | 'not-enough-shards' | 'numeric-range'

export interface BuyResult {
  readonly ok: boolean
  readonly reason?: BuyFailure
}
