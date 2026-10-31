import { CARD_REGISTRY } from '../content/cards'
import type { Game } from './game'
import { DEFAULT_FAVORITES, orderPreset, moveTarget, removeTarget, readPreset, validateFavorites, validateQuickMode, validateTargets, type BuildPreset, type UpgradeTarget, type QuickMode } from './upgradePlans'
import type { PlanView, PlansHandlers, PresetView } from '../ui/sections/plans'
interface PresetStore { version: 2; presets: PresetView[]; favorites: string[]; quickMode: QuickMode }
export type PlanSession = Pick<Game, 'panelState' | 'plan' | 'setPlan' | 'setAutoBuy' | 'setQuickMode' | 'moveQueued' | 'removeQueued' | 'queueUpgrade'>
function draft(name = '新预设', targets: readonly UpgradeTarget[] = [], favorites: readonly string[] = DEFAULT_FAVORITES, quickMode: QuickMode = 'planned'): BuildPreset { return { format: 'prism-build', version: 2, name, targets, favorites, quickMode } }
function defaults(): PresetStore {
  const make = (id: string, name: string, targets: Record<string, number>): PresetView => ({ id, ...draft(name, Object.entries(targets).map(([id, level]) => ({ id, level }))) })
  return { version: 2, favorites: [...DEFAULT_FAVORITES], quickMode: 'planned', presets: [
    make('sword', '飞剑', { 'gun-pierce': 2, 'gun-range': 2, homing: 1, suspension: 2, 'pierce-drive': 1, ricochet: 1, magnet: 1 }),
    make('mines', '雷场', { 'mine-power': 2, 'mine-slow': 2, miner: 1, grenade: 1, sluggish: 1, shrapnel: 1, magnet: 1 }),
    make('sniper', '狙击', { 'gun-damage': 2, 'gun-range': 2, 'gun-bulletspeed': 1, 'gun-pierce': 1, 'precision-stance': 1 }),
  ] }
}
export function createPlanManager(options: { game: () => PlanSession | undefined; refresh: () => void; saved: () => void }) {
  let store = defaults(), message = '', editing: string | null = null, current = draft()
  try {
    const raw = JSON.parse(localStorage.getItem('prism.builds.v2') ?? localStorage.getItem('prism.builds.v1') ?? 'null')
    if ((raw?.version === 1 || raw?.version === 2) && Array.isArray(raw.presets) && raw.presets.length <= 16) {
      store = { version: 2, favorites: raw.version === 1 ? [...new Set((raw.quickSlots as (string | null)[]).filter(Boolean))] as string[] : validateFavorites(raw.favorites), quickMode: raw.version === 1 ? 'planned' : validateQuickMode(raw.quickMode), presets: raw.presets.map((p: PresetView, i: number) => ({ ...readPreset(JSON.stringify(p)), id: typeof p.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(p.id) ? p.id : `restored-${i}` })) }
      store.favorites = validateFavorites(store.favorites)
    }
  } catch { /* A damaged collection must not break startup or overwrite its bytes. */ }
  const persist = () => { try { localStorage.setItem('prism.builds.v2', JSON.stringify(store)); return true } catch { message = '浏览器无法保存预设，本次仍可使用；请导出备份。'; return false } }
  const update = (text = '') => { if (text) message = text; options.refresh() }
  const planChanged = () => { options.saved(); update() }
  const actions: PlansHandlers = {
    name: (value) => { current = { ...current, name: value } },
    target: (index, level) => {
      try {
        const item = current.targets[index]; if (!item) return
        const delta = level - item.level
        const targets = level === 0 ? removeTarget(current.targets, index) : current.targets.map((t, i) => i >= index && t.id === item.id ? { id: t.id, level: t.level + delta } : t)
        current = { ...current, targets: validateTargets(targets) }; update()
      }
      catch (error) { update(error instanceof Error ? error.message : '目标等级无效') }
    },
    add: (id) => { try { const level = Math.max(0, ...current.targets.filter((t) => t.id === id).map((t) => t.level)) + 1; current = { ...current, targets: validateTargets([...current.targets, { id, level }]) }; update() } catch (error) { update(error instanceof Error ? error.message : '不能再购买此卡片') } },
    moveTarget: (index, direction) => { current = { ...current, targets: moveTarget(current.targets, index, direction) }; update() },
    favorite: (id) => { if (!CARD_REGISTRY.get(id)) return; store.favorites = store.favorites.includes(id) ? store.favorites.filter((c) => c !== id) : [...store.favorites, id]; current = { ...current, favorites: [...store.favorites] }; persist(); update() },
    mode: (mode) => { store.quickMode = mode; options.game()?.setQuickMode(mode); current = { ...current, quickMode: mode }; persist(); options.saved(); update() },
    fresh: () => { current = draft('新预设', [], store.favorites, store.quickMode); editing = null; update('填写名称与目标等级，然后保存。') },
    capture: () => { const game = options.game(); if (!game) return; current = draft(current.name, game.panelState().cards.filter((c) => c.level > 0).map((c) => ({ id: c.id, level: c.level })), store.favorites, game.plan().quickMode ?? store.quickMode); update('已填入当前构筑，保存后可复用。') },
    save: () => {
      try {
        const preset = readPreset(JSON.stringify({ ...current, favorites: store.favorites, quickMode: store.quickMode }))
        if (!editing && store.presets.length >= 16) throw new Error('最多保存 16 个预设，可编辑已有预设')
        const id = editing ?? crypto.randomUUID(), value = { ...preset, id }
        store.presets = [...store.presets.filter((p) => p.id !== id), value]; editing = id; current = preset
        message = `已保存“${preset.name}”。`; persist(); update()
      } catch (error) { update(error instanceof Error ? error.message : '无法保存预设') }
    },
    edit: (id) => { const preset = store.presets.find((p) => p.id === id); if (preset) { current = structuredClone(preset); editing = id; update(`正在编辑“${preset.name}”。`) } },
    apply: (id) => {
      const preset = store.presets.find((p) => p.id === id), game = options.game()
      if (!preset || !game) return
      if (!game.setPlan(orderPreset(preset.targets))) { update('此预设无法应用'); return }
      store.favorites = [...preset.favorites]; store.quickMode = preset.quickMode; game.setQuickMode(preset.quickMode); message = `已载入“${preset.name}”预购。可购买时会提示，开启自动购买则提示三秒后购买；前置不足时请调整顺序。`; persist(); options.saved(); update()
    },
    export: (id) => {
      const preset = store.presets.find((p) => p.id === id); if (!preset) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(readPreset(JSON.stringify(preset)))], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `PRISM_build_${preset.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); update(`已导出“${preset.name}”。`)
    },
    import: async (file) => {
      try { if (file.size > 128 * 1024) throw new Error('预设文件不能超过 128 KiB'); const preset = readPreset(await file.text()); if (store.presets.length >= 16) throw new Error('已有 16 个预设，请编辑现有预设'); store.presets.push({ ...preset, id: crypto.randomUUID() }); message = `已导入“${preset.name}”，尚未购买卡片。`; persist(); update() }
      catch (error) { update(`${error instanceof Error ? error.message : '导入失败'}。已有预设未改变。`) }
    },
    toggle: (enabled) => { options.game()?.setAutoBuy(enabled); planChanged() },
    move: (index, direction) => { options.game()?.moveQueued(index, direction); planChanged() },
    remove: (index) => { options.game()?.removeQueued(index); planChanged() },
    queue: (id, level) => { if (options.game()?.queueUpgrade(id, level)) { message = '已加入预购队列。'; planChanged() } else update('无法加入预购，请检查目标等级') },
  }
  const state = (): PlanView => {
    const game = options.game(), cards = game?.panelState().cards, plan = game?.plan()
    return { canUse: Boolean(game), cards: CARD_REGISTRY.all().map((c) => ({ id: c.id, name: c.name, level: cards?.find((v) => v.id === c.id)?.level ?? 0 })),
      presets: store.presets, draft: current, editing: Boolean(editing), message, favorites: store.favorites, quickMode: plan?.quickMode ?? store.quickMode, enabled: plan?.enabled ?? false,
      queue: (plan?.targets ?? []).map((target) => { const card = cards!.find((c) => c.id === target.id)!; return { ...target, name: card.name, current: card.level, price: card.price,
        status: card.level >= target.level ? '目标已完成' : card.availability === 'locked' ? '等待前置升级' : card.availability === 'not-enough-shards' ? '等待足够棱晶' : '继续游戏后购买' } }),
    }
  }
  return { state, actions, favorites: () => store.favorites, quickMode: () => options.game()?.plan().quickMode ?? store.quickMode }
}
