import { CARD_REGISTRY } from '../content/cards'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { isFiniteBuild, resolveAttrs } from '../core/cards'
import { array, integer, record } from '../core/serialization'
import { migrateFavoriteIds, migrateOrderedTargets } from './cardMigrations'
export interface UpgradeTarget { readonly id: string; readonly level: number }
export type QuickMode = 'favorites' | 'planned'
export interface PurchasePlan { enabled: boolean; targets: UpgradeTarget[]; quickMode?: QuickMode }
export interface BuildPreset { readonly format: 'prism-build'; readonly version: 2; readonly name: string; readonly targets: readonly UpgradeTarget[]; readonly favorites: readonly string[]; readonly quickMode: QuickMode }
export const DEFAULT_FAVORITES = ['gun-damage', 'gun-firerate', 'gun-range', 'gun-pierce', 'magnet']
export function validateTargets(value: unknown): UpgradeTarget[] {
  const levels = new Map<string, number>()
  const targets = migrateOrderedTargets(value).map((value) => {
    const item = record(value), id = typeof item.id === 'string' ? item.id : '', card = CARD_REGISTRY.get(id)
    if (!card) throw new Error('预设含未知卡片')
    const level = integer(item.level, (levels.get(id) ?? 0) + 1, card.maxLevel); levels.set(id, level)
    if (!Number.isFinite(card.priceFn(level))) throw new Error('目标等级超出可计算范围')
    return { id, level }
  })
  if (!isFiniteBuild(resolveAttrs(PLAYER_BASE_ATTRS, [...levels].map(([id, level]) => ({ id, level })), CARD_REGISTRY))) throw new Error('此构筑数值无法计算')
  return targets
}
export function validateFavorites(value: unknown): string[] {
  const ids = migrateFavoriteIds(value)
  if (ids.some((id) => typeof id !== 'string' || !CARD_REGISTRY.get(id)) || new Set(ids).size !== ids.length) throw new Error('收藏卡片配置无效')
  return ids as string[]
}
export function validateQuickMode(value: unknown): QuickMode {
  if (value !== 'favorites' && value !== 'planned') throw new Error('快捷购买方式无效')
  return value
}
export function readPreset(text: string): BuildPreset {
  if (text.length > 128 * 1024) throw new Error('预设文件过大')
  const d = record(JSON.parse(text))
  if (d.format !== 'prism-build' || (d.version !== 1 && d.version !== 2)) throw new Error('不是受支持的升级预设')
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 40) throw new Error('预设名称须为 1–40 字')
  let favorites: string[], quickMode: QuickMode
  if (d.version === 1) {
    const old = array(d.quickSlots, 5)
    if (old.length !== 5) throw new Error('快捷栏配置无效')
    favorites = validateFavorites([...new Set(migrateFavoriteIds(old.filter((id) => id !== null)))]); quickMode = 'planned'
  } else { favorites = validateFavorites(d.favorites); quickMode = validateQuickMode(d.quickMode) }
  return { format: 'prism-build', version: 2, name: d.name.trim(), targets: validateTargets(d.targets), favorites, quickMode }
}
export function orderPreset(targets: readonly UpgradeTarget[]): UpgradeTarget[] {
  return targets.map((t) => ({ ...t }))
}
/** Moving a repeated card preserves the ascending milestones for that card. */
export function moveTarget(targets: readonly UpgradeTarget[], index: number, direction: -1 | 1): UpgradeTarget[] {
  const next = targets.map((t) => ({ ...t })), other = index + direction
  if (index < 0 || other < 0 || index >= next.length || other >= next.length) return next
  const levels = new Map<string, number[]>()
  for (const t of next) levels.set(t.id, [...(levels.get(t.id) ?? []), t.level])
  ;[next[index], next[other]] = [next[other]!, next[index]!]
  return next.map((t) => ({ id: t.id, level: levels.get(t.id)!.shift()! }))
}
export function removeTarget(targets: readonly UpgradeTarget[], index: number, current: (id: string) => number = () => 0): UpgradeTarget[] {
  const removed = targets[index]; if (!removed) return [...targets]
  const previous = targets.slice(0, index).filter((t) => t.id === removed.id).at(-1)?.level ?? current(removed.id)
  const count = Math.max(0, removed.level - previous)
  return targets.filter((_, i) => i !== index).map((t, i) => i >= index && t.id === removed.id ? { id: t.id, level: t.level - count } : { ...t })
}

/** Append explicit milestones, recursively inserting missing card prerequisites in a portable draft. */
export function appendPresetTargets(targets:readonly UpgradeTarget[],id:string,count=1,withRequirements=true):UpgradeTarget[]{
 if(!Number.isInteger(count)||count<1||count>50)throw new Error('每次追加次数须为1–50')
 const result=targets.map(t=>({...t})),levelOf=(key:string)=>result.filter(t=>t.id===key).at(-1)?.level??0
 const ensure=(key:string,level:number,path:Set<string>)=>{
  if(levelOf(key)>=level)return
  if(path.has(key))throw new Error('卡片前置存在循环')
  const card=CARD_REGISTRY.get(key);if(!card)throw new Error('未知卡片')
  if(card.maxLevel!==undefined&&level>card.maxLevel)throw new Error('此卡片已经达到最高等级')
  if(withRequirements)for(const requirement of card.requires??[])if(requirement.card)ensure(requirement.card,requirement.level??1,new Set([...path,key]))
  result.push({id:key,level})
 }
 const card=CARD_REGISTRY.get(id);if(!card)throw new Error('未知卡片')
 for(let i=0;i<(card.maxLevel===1?1:count);i++)ensure(id,levelOf(id)+1,new Set())
 return validateTargets(result)
}
export function duplicatePresetTarget(targets:readonly UpgradeTarget[],index:number):UpgradeTarget[]{
 const selected=targets[index];if(!selected)return [...targets]
 return validateTargets([...targets.slice(0,index+1),{id:selected.id,level:selected.level+1},...targets.slice(index+1).map(t=>t.id===selected.id?{id:t.id,level:t.level+1}:{...t})])
}
export function presetCost(targets:readonly UpgradeTarget[]):number {
 const levels=new Map<string,number>();let total=0
 for(const target of targets){const card=CARD_REGISTRY.get(target.id);if(!card)return Infinity;for(let level=(levels.get(target.id)??0)+1;level<=target.level;level++)total+=card.priceFn(level);levels.set(target.id,target.level)}
 return total
}
