import type { AttrSet } from '../core/attrs'
import type { EnemySpawnSpec, MonsterTrait } from '../core/world'
import { nextFloat, nextInt, type Rng } from '../core/rng'
export const TRAIT_NAMES: Record<MonsterTrait, string> = { bark: '树皮', swift: '迅捷', bulwark: '重甲', storm: '雷涌', cinder: '炽热', volatile: '裂核' }
const POOL = Object.keys(TRAIT_NAMES) as MonsterTrait[]
/** Seeded content assembly; never mutates shared enemy archetypes. */
export function withMonsterTraits(spec: EnemySpawnSpec, rng: Rng, threat: number): EnemySpawnSpec {
  let result = { ...spec, attrs: { ...spec.attrs }, traits: [...(spec.traits ?? [])] }
  const count = (nextFloat(rng) < 0.28 + threat * 0.035 ? 1 : 0) + (threat >= 5 && nextFloat(rng) < 0.35 ? 1 : 0)
  const pool = POOL.filter((t) => !result.traits.includes(t) && (spec.behavior !== 'boss' || t !== 'volatile'))
  for (let i = 0; i < count && pool.length; i++) {
    const trait = pool.splice(nextInt(rng, 0, pool.length), 1)[0]!, a = result.attrs
    result.traits.push(trait)
    if (trait === 'bark') { a.block += 4 * (1 + threat * 0.08); a.maxHp *= 1.2; a.speed *= 0.92; a.heatResist -= 20 }
    if (trait === 'swift') { a.speed *= 1.25; a.fireRate *= 1.1 }
    if (trait === 'bulwark') { a.armor += 25; a.physicalResist += 20; a.speed *= 0.9 }
    if (trait === 'storm') { a.electricResist += 60; a.heatResist -= 20; result = { ...result, attackType: 'electric' } }
    if (trait === 'cinder') { a.heatResist += 60; a.electricResist -= 20; result = { ...result, attackType: 'heat' } }
  }
  return { ...result, attackType: result.traits.includes('cinder') ? 'heat' : result.traits.includes('storm') ? 'electric' : spec.attackType,
    name: `${result.traits.map((t) => TRAIT_NAMES[t]).join('·')}${result.traits.length ? '·' : ''}${spec.name ?? '敌人'}` }
}
/** Applied after traits so bounded floors also bound trait-derived defenses. */
export function clampMonsterStats(attrs: AttrSet, maxima: Partial<AttrSet>): AttrSet {
  const result = { ...attrs }
  for (const key of Object.keys(maxima) as (keyof AttrSet)[]) result[key] = Math.min(result[key], maxima[key]!)
  return result
}
