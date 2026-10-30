import { CARD_REGISTRY } from '../content/cards'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { isFiniteBuild, resolveAttrs } from '../core/cards'
import { array, integer, record } from '../core/serialization'
export interface UpgradeTarget { readonly id: string; readonly level: number }
export interface PurchasePlan { enabled: boolean; targets: UpgradeTarget[] }
export interface BuildPreset { readonly format: 'prism-build'; readonly version: 1; readonly name: string; readonly targets: readonly UpgradeTarget[]; readonly quickSlots: readonly (string | null)[] }
export const DEFAULT_QUICK = ['gun-damage', 'gun-firerate', 'gun-range', 'gun-pierce', 'magnet']
export function validateTargets(value: unknown): UpgradeTarget[] {
  const seen = new Set<string>()
  const targets = array(value, CARD_REGISTRY.all().length).map((value) => {
    const item = record(value), id = typeof item.id === 'string' ? item.id : '', card = CARD_REGISTRY.get(id)
    if (!card || seen.has(id)) throw new Error('预设含未知或重复卡片')
    seen.add(id); const level = integer(item.level, 1, card.maxLevel)
    if (!Number.isFinite(card.priceFn(level))) throw new Error('目标等级超出可计算范围')
    return { id, level }
  })
  if (!isFiniteBuild(resolveAttrs(PLAYER_BASE_ATTRS, targets, CARD_REGISTRY))) throw new Error('此构筑数值无法计算')
  return targets
}
export function validateQuick(value: unknown): (string | null)[] {
  const slots = array(value, 5)
  if (slots.length !== 5 || slots.some((id) => id !== null && (typeof id !== 'string' || !CARD_REGISTRY.get(id)))) throw new Error('快捷栏配置无效')
  return slots as (string | null)[]
}
export function readPreset(text: string): BuildPreset {
  if (text.length > 128 * 1024) throw new Error('预设文件过大')
  const d = record(JSON.parse(text))
  if (d.format !== 'prism-build' || d.version !== 1) throw new Error('不是受支持的升级预设')
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 40) throw new Error('预设名称须为 1–40 字')
  return { format: 'prism-build', version: 1, name: d.name.trim(), targets: validateTargets(d.targets), quickSlots: validateQuick(d.quickSlots) }
}
export function orderPreset(targets: readonly UpgradeTarget[]): UpgradeTarget[] {
  const pending = [...targets].sort((a, b) => CARD_REGISTRY.get(a.id)!.priority - CARD_REGISTRY.get(b.id)!.priority || a.id.localeCompare(b.id)), ordered: UpgradeTarget[] = []
  while (pending.length) {
    const index = pending.findIndex((item) => (CARD_REGISTRY.get(item.id)!.requires ?? []).every((r) => !r.card || !pending.some((p) => p.id === r.card)))
    ordered.push(pending.splice(index < 0 ? 0 : index, 1)[0]!)
  }
  return ordered
}
