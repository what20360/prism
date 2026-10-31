import { CARD_REGISTRY } from '../content/cards'
import { LEGACY_V3_REGISTRY } from '../content/legacyCardsV3'
import { LEGACY_V4_REGISTRY } from '../content/legacyCardsV4'
import { RETIRED_CARDS } from '../content/cardRoles'
import { LEGACY_V1_REGISTRY, LEGACY_V2_REGISTRY } from '../content/legacyCards'
import { isFiniteBuild, resolveAttrs, type CardRegistry, type Purchase } from '../core/cards'
import { array, integer, record } from '../core/serialization'
import { reapplyAttrs } from '../core/progress'
import { shieldCap, type AttrSet } from '../core/attrs'
import type { World } from '../core/world'
import type { UpgradeTarget } from './upgradePlans'
export const CURRENT_BALANCE_VERSION = 5
export function canonicalCardId(id: string): string { return Object.hasOwn(RETIRED_CARDS, id) ? RETIRED_CARDS[id]! : id }
export function migrateFavoriteIds(value: unknown): string[] {
  const ids = array(value, Math.max(CARD_REGISTRY.all().length, LEGACY_V2_REGISTRY.all().length)).map((id) => {
    if (typeof id !== 'string' || !CARD_REGISTRY.get(canonicalCardId(id))) throw new Error('收藏卡片配置无效')
    return id
  })
  return ids.some((id) => canonicalCardId(id) !== id) ? [...new Set(ids.map(canonicalCardId))] : ids
}
/** Convert each historical milestone without sorting or losing unbought steps. */
export function migrateOrderedTargets(value: unknown, owned: readonly Purchase[] = [], legacyRun = false): UpgradeTarget[] {
  const seen = new Map<string, number>()
  const targets = array(value, 2048).map((value) => {
    const row = record(value), id = typeof row.id === 'string' ? row.id : '', card = CARD_REGISTRY.get(id) ?? LEGACY_V2_REGISTRY.get(id)
    if (!card) throw new Error('预设含未知卡片')
    const level = integer(row.level, (seen.get(id) ?? 0) + 1, card.maxLevel); seen.set(id, level)
    if (!Number.isFinite(card.priceFn(level))) throw new Error('目标等级超出可计算范围')
    return { id, level }
  })
  if (!legacyRun && !targets.some((t) => canonicalCardId(t.id) !== t.id)) return targets
  const goals = new Map(owned.map((p) => [p.id, p.level])), emitted = new Map<string, number>(), result: UpgradeTarget[] = []
  const total = (id: string) => [...goals].reduce((sum, [oldId, level]) => sum + (canonicalCardId(oldId) === id ? level : 0), 0)
  for (const p of owned) emitted.set(canonicalCardId(p.id), total(canonicalCardId(p.id)))
  for (const target of targets) {
    if (target.level <= (goals.get(target.id) ?? 0)) continue
    goals.set(target.id, target.level)
    const id = canonicalCardId(target.id), level = total(id)
    if (level > (emitted.get(id) ?? 0)) { result.push({ id, level }); emitted.set(id, level) }
  }
  return result
}
function matches(actual: AttrSet, expected: AttrSet): boolean {
  return (Object.keys(expected) as (keyof AttrSet)[]).every((key) => Math.abs(actual[key] - expected[key]) <= 1e-7 * Math.max(1, Math.abs(expected[key])))
}
export function registryForSave(version: unknown): CardRegistry {
  if (version === CURRENT_BALANCE_VERSION) return CARD_REGISTRY
  if (version === 4) return LEGACY_V4_REGISTRY
  if (version === 3) return LEGACY_V3_REGISTRY
  if (version === 1) return LEGACY_V1_REGISTRY
  if (version === 2 || version === undefined) return LEGACY_V2_REGISTRY
  throw new Error('不支持的存档数值版本')
}
export function migrateWorldBuild(world: World, version: unknown): { world: World; legacy: boolean; owned: readonly Purchase[] } {
  const player = [...world.actors.values()].find((a) => a.team === 'player')!
  const candidates = version === undefined ? [LEGACY_V2_REGISTRY, LEGACY_V1_REGISTRY] : [registryForSave(version)]
  const registry = candidates.find((r) => matches(player.attrs, resolveAttrs(world.basePlayerAttrs, world.purchases, r)))
  if (!registry) throw new Error('卡片与角色属性不匹配')
  const owned = structuredClone(world.purchases)
  if (registry === CARD_REGISTRY) return { world, legacy: false, owned }
  const merged = new Map<string, Purchase>()
  for (const purchase of owned) {
    const id = canonicalCardId(purchase.id), next = merged.get(id) ?? { id, level: 0, paid: [] }, old = registry.get(purchase.id)!
    for (let level = 1; level <= purchase.level; level++) next.paid!.push(purchase.paid?.[level - 1] ?? old.priceFn(level))
    next.level += purchase.level; merged.set(id, next)
  }
  const purchases = [...merged.values()], attrs = resolveAttrs(world.basePlayerAttrs, purchases, CARD_REGISTRY)
  if (!isFiniteBuild(attrs) || purchases.some((p) => !Number.isFinite(CARD_REGISTRY.get(p.id)!.priceFn(p.level)))) throw new Error('旧构筑超出当前可计算范围')
  const migrated: World = { ...world, registry: CARD_REGISTRY, purchases }, hp = player.hp, shield = player.shield
  reapplyAttrs(migrated, player)
  player.hp = Math.min(hp, player.attrs.maxHp); player.shield = Math.min(shield, shieldCap(player.attrs))
  for (const pickup of migrated.pickups) if ((registry === LEGACY_V1_REGISTRY || registry === LEGACY_V2_REGISTRY) && pickup.kind === 'shard') pickup.gainApplied = true
  return { world: migrated, legacy: true, owned }
}
