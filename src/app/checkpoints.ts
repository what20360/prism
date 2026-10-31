import { CARD_REGISTRY } from '../content/cards'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { buildDungeon } from '../content/dungeon'
import { array, integer, record, restoreWorld, type WorldData } from '../core/serialization'
import { resolveAttrs } from '../core/cards'
import { MAX_SAVE_BYTES } from '../storage/saveStore'
import type { EndlessCheckpoint } from './modes/endless'
import { validateTargets, validateQuickMode, type PurchasePlan } from './upgradePlans'
import { dungeonDifficulty, type DungeonDifficulty } from '../content/difficulties'
export interface RunCheckpoint {
  readonly name?: string
  readonly difficulty?: DungeonDifficulty
  readonly format: 'prism-save'; readonly version: 1; readonly savedAt: string
  readonly mode: 'dungeon' | 'endless'; readonly initialSeed: number; readonly restarts: number; readonly roomIndex: number
  readonly world: WorldData; readonly endless?: EndlessCheckpoint
  readonly plan?: PurchasePlan
}
export function readCheckpoint(text: string): RunCheckpoint {
  if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES) throw new Error('存档不能超过 2 MiB')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('请选择有效的 JSON 存档文件') }
  const d = record(raw)
  if (d.format !== 'prism-save' || d.version !== 1) throw new Error('不支持的存档版本')
  if (d.name !== undefined) d.name = validateSaveName(d.name)
  if (d.mode !== 'dungeon' && d.mode !== 'endless') throw new Error('该模式不支持读档')
  if (d.difficulty !== undefined) { dungeonDifficulty(d.difficulty); if (d.mode !== 'dungeon') throw new Error('难度模式无效') }
  if (typeof d.savedAt !== 'string' || d.savedAt.length > 40 || !Number.isFinite(Date.parse(d.savedAt))) throw new Error('存档时间无效')
  if (d.plan !== undefined) { const plan = record(d.plan); if (typeof plan.enabled !== 'boolean') throw new Error('预购开关无效'); validateTargets(plan.targets); if (plan.quickMode !== undefined) validateQuickMode(plan.quickMode) }
  integer(d.initialSeed); integer(d.restarts); integer(d.roomIndex, 0, buildDungeon().length - 1)
  const world = restoreWorld(d.world, CARD_REGISTRY, DEFAULT_ECONOMY, Object.keys(PLAYER_BASE_ATTRS))
  if (world.participants) throw new Error('联网对局不能作为单人存档导入')
  const player = [...world.actors.values()].find((a) => a.team === 'player')!
  if (!player.alive || world.gameOver || world.victory) throw new Error('此存档中的对局已经结束')
  const resolved = resolveAttrs(world.basePlayerAttrs, world.purchases, CARD_REGISTRY)
  for (const key of Object.keys(resolved) as (keyof typeof resolved)[]) if (Math.abs(player.attrs[key] - resolved[key]) > 1e-7 * Math.max(1, Math.abs(resolved[key]))) throw new Error('卡片与角色属性不匹配')
  if (d.mode === 'endless') {
    const e = record(d.endless); integer(e.floor, 1); integer(e.rngState, 0, 0xffffffff); integer(e.respawned)
    for (const tick of array(e.spawnQueue, 2000)) integer(tick, 0)
    if (world.seed !== d.initialSeed || d.roomIndex !== 0) throw new Error('无尽种子或层数无效')
  } else if (world.seed !== (d.difficulty === undefined ? finiteSeed(d.initialSeed, d.restarts) : d.initialSeed) || d.endless !== undefined) throw new Error('闯关进度无效')
  return JSON.parse(JSON.stringify(d)) as RunCheckpoint
}
export function validateSaveName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('存档名称须为 1–40 个字符，不能包含控制字符')
  return value.trim()
}
/** Slot names survive overwrites; an empty slot inherits the imported name. */
export function preserveSaveName(saved: RunCheckpoint, existing?: RunCheckpoint): RunCheckpoint {
  return { ...saved, name: existing?.name ?? saved.name }
}
function finiteSeed(seed: unknown, restarts: unknown): number { return integer(seed) + integer(restarts) }
export function checkpointLabel(saved: RunCheckpoint): string {
  return `${saved.mode === 'endless' ? `无尽第 ${saved.endless!.floor} 层` : `闯关${saved.difficulty ? ` D${saved.difficulty}` : ''} F${Math.floor(saved.roomIndex / 5) + 1}-${saved.roomIndex % 5 + 1}`} · 生命 ${Math.ceil(saved.world.actors.find((a) => a.team === 'player')!.hp)} · ${saved.world.purchases.reduce((n, p) => n + p.level, 0)} 级构筑`
}
