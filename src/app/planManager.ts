import { CARD_REGISTRY } from '../content/cards'
import type { Game } from './game'
import { DEFAULT_QUICK, orderPreset, readPreset, validateQuick, validateTargets, type BuildPreset, type UpgradeTarget } from './upgradePlans'
import type { PlanView, PlansHandlers, PresetView } from '../ui/sections/plans'
interface PresetStore { version: 1; presets: PresetView[]; quickSlots: (string | null)[] }
function draft(name = '新预设', targets: readonly UpgradeTarget[] = [], quickSlots: readonly (string | null)[] = DEFAULT_QUICK): BuildPreset { return { format: 'prism-build', version: 1, name, targets, quickSlots } }
function defaults(): PresetStore {
  const make = (id: string, name: string, targets: Record<string, number>): PresetView => ({ id, ...draft(name, Object.entries(targets).map(([id, level]) => ({ id, level }))) })
  return { version: 1, quickSlots: [...DEFAULT_QUICK], presets: [
    make('sword', '飞剑', { 'gun-pierce': 2, 'gun-range': 2, homing: 1, suspension: 2, 'pierce-drive': 1, ricochet: 1, magnet: 1 }),
    make('mines', '雷场', { 'mine-power': 2, 'mine-slow': 2, miner: 1, grenade: 1, sluggish: 1, shrapnel: 1, magnet: 1 }),
    make('sniper', '狙击', { 'gun-damage': 2, 'gun-range': 2, 'gun-bulletspeed': 1, 'gun-pierce': 1, 'precision-stance': 1 }),
  ] }
}
export function createPlanManager(options: { game: () => Game | undefined; refresh: () => void; saved: () => void }) {
  let store = defaults(), message = '', editing: string | null = null, current = draft()
  try {
    const raw = JSON.parse(localStorage.getItem('prism.builds.v1') ?? 'null') as PresetStore | null
    if (raw?.version === 1 && Array.isArray(raw.presets) && raw.presets.length <= 16) {
      store = { version: 1, quickSlots: validateQuick(raw.quickSlots), presets: raw.presets.map((p, i) => ({ ...readPreset(JSON.stringify(p)), id: typeof p.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(p.id) ? p.id : `restored-${i}` })) }
    }
  } catch { /* A damaged collection must not break startup or overwrite its bytes. */ }
  const persist = () => { try { localStorage.setItem('prism.builds.v1', JSON.stringify(store)); return true } catch { message = '浏览器无法保存预设，本次仍可使用；请导出备份。'; return false } }
  const update = (text = '') => { if (text) message = text; options.refresh() }
  const planChanged = () => { options.saved(); update() }
  const actions: PlansHandlers = {
    name: (value) => { current = { ...current, name: value } },
    target: (id, level) => {
      try { const targets = validateTargets([...current.targets.filter((t) => t.id !== id), ...(level === 0 ? [] : [{ id, level }])]); current = { ...current, targets }; update() }
      catch (error) { update(error instanceof Error ? error.message : '目标等级无效') }
    },
    quick: (slot, id) => { const slots = [...store.quickSlots]; slots[slot] = id; try { store.quickSlots = validateQuick(slots); current = { ...current, quickSlots: [...slots] }; persist(); update() } catch { update('快捷栏配置无效') } },
    fresh: () => { current = draft('新预设', [], store.quickSlots); editing = null; update('填写名称与目标等级，然后保存。') },
    capture: () => { const game = options.game(); if (!game) return; current = draft(current.name, game.panelState().cards.filter((c) => c.level > 0).map((c) => ({ id: c.id, level: c.level })), store.quickSlots); update('已填入当前构筑，保存后可复用。') },
    save: () => {
      try {
        const preset = readPreset(JSON.stringify({ ...current, quickSlots: store.quickSlots }))
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
      store.quickSlots = [...preset.quickSlots]; message = `已载入“${preset.name}”预购。按队列补齐目标，不会自动卖卡；前置不足时请先购买或调整顺序。`; persist(); options.saved(); update()
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
      presets: store.presets, draft: current, editing: Boolean(editing), message, quickSlots: store.quickSlots, enabled: plan?.enabled ?? false,
      queue: (plan?.targets ?? []).map((target) => { const card = cards!.find((c) => c.id === target.id)!; return { ...target, name: card.name, current: card.level, price: card.price,
        status: card.level >= target.level ? '目标已完成' : card.availability === 'locked' ? '等待前置升级' : card.availability === 'not-enough-shards' ? '等待足够棱晶' : '继续游戏后购买' } }),
    }
  }
  return { state, actions, quickSlots: () => store.quickSlots }
}
