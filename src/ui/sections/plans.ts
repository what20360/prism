import type { BuildPreset, UpgradeTarget, QuickMode } from '../../app/upgradePlans'
export interface PresetView extends BuildPreset { readonly id: string }
export interface PlanView {
  readonly canUse: boolean; readonly cards: readonly { id: string; name: string; level: number }[]
  readonly presets: readonly PresetView[]; readonly draft: BuildPreset; readonly editing: boolean; readonly message: string
  readonly queue: readonly { id: string; name: string; level: number; current: number; price: number; status: string }[]; readonly enabled: boolean
  readonly favorites: readonly string[]; readonly quickMode: QuickMode
}
export interface PlansHandlers {
  name(value: string): void; target(index: number, level: number): void; add(id: string): void; moveTarget(index: number, direction: -1 | 1): void; favorite(id: string): void; mode(mode: QuickMode): void
  save(): void; capture(): void; fresh(): void; edit(id: string): void; apply(id: string): void; export(id: string): void; import(file: File): void
  toggle(enabled: boolean): void; move(index: number, direction: -1 | 1): void; remove(index: number): void; queue(id: string, level: number): void
}
export function renderPlansSection(state: PlanView, actions: PlansHandlers): HTMLElement {
  const root = document.createElement('section'); root.className = 'plans-page'
  const title = document.createElement('h2'); title.textContent = '升级预设与预购'
  const note = document.createElement('p'); note.className = 'cards__intro'; note.textContent = '按列表从上到下购卡，同一卡片可重复，例如伤害 → 射程 → 攻速 → 伤害。每项升级至标注等级，已有等级跳过；前置或余额不足时在当前项等待。流派提示满三秒后才会自动购买，也可点击购买。'
  const status = document.createElement('p'); status.className = 'save-status'; status.setAttribute('role', 'status'); status.textContent = state.message
  root.append(title, note, status)
  const button = (parent: HTMLElement, label: string, run: () => void, disabled = false) => { const b = document.createElement('button'); b.className = 'settings__option'; b.type = 'button'; b.textContent = label; b.onclick = run; b.disabled = disabled; parent.append(b); return b }
  const select = (label: string, value: string | null, parent: HTMLElement, blank = false) => {
    const wrap = document.createElement('label'); wrap.className = 'plan-field'; wrap.textContent = label
    const s = document.createElement('select'); s.setAttribute('aria-label', label)
    if (blank) { const o = document.createElement('option'); o.value = ''; o.textContent = '留空'; s.append(o) }
    for (const card of state.cards) { const o = document.createElement('option'); o.value = card.id; o.textContent = card.name; s.append(o) }
    s.value = value ?? ''; wrap.append(s); parent.append(wrap); return s
  }
  const heading = (text: string) => { const h = document.createElement('h3'); h.textContent = text; root.append(h) }
  heading('预购队列')
  button(root, `自动购买：${state.enabled ? '开启' : '关闭'}`, () => actions.toggle(!state.enabled), !state.canUse)
  const list = document.createElement('ol'); list.className = 'plan-queue'
  for (const [index, item] of state.queue.entries()) {
    const row = document.createElement('li'), text = document.createElement('span'); text.textContent = `${item.name} Lv${item.current} → Lv${item.level} · 下一级 ${item.price} 棱晶 · ${index ? '排队中' : item.status}`; row.append(text)
    button(row, `上移${item.name}`, () => actions.move(index, -1), index === 0); button(row, `下移${item.name}`, () => actions.move(index, 1), index === state.queue.length - 1); button(row, `移除${item.name}`, () => actions.remove(index)); list.append(row)
  }
  if (!state.queue.length) { const empty = document.createElement('p'); empty.className = 'settings__hint'; empty.textContent = '队列为空。可载入预设，或从升级卡片旁点击“预购”。'; root.append(empty) }
  root.append(list)
  heading('快捷购买方式')
  for (const [mode, label] of [['favorites', '收藏卡片'], ['planned', '流派提示']] as const) { const b = button(root, label, () => actions.mode(mode)); b.setAttribute('aria-pressed', String(state.quickMode === mode)) }
  const favoriteNote = document.createElement('p'); favoriteNote.className = 'settings__hint'; favoriteNote.textContent = '收藏卡片在升级页有独立分类，并可从屏幕边缘展开购买。流派提示按预购队列逐级出现；选择收藏方式时暂停流派自动购买。'; root.append(favoriteNote)
  const favorites = document.createElement('div'); favorites.className = 'favorite-editor'
  for (const card of state.cards) { const b = button(favorites, `${state.favorites.includes(card.id) ? '★' : '☆'} ${card.name}`, () => actions.favorite(card.id)); b.setAttribute('aria-label', `${state.favorites.includes(card.id) ? '取消收藏' : '收藏'}${card.name}`); b.setAttribute('aria-pressed', String(state.favorites.includes(card.id))) }
  root.append(favorites)
  heading('保存的预设')
  const presets = document.createElement('div'); presets.className = 'preset-list'
  for (const preset of state.presets) {
    const card = document.createElement('article'); card.className = 'save-slot'; const name = document.createElement('h4'); name.textContent = preset.name
    const summary = document.createElement('p'); summary.className = 'settings__hint'; summary.textContent = preset.targets.map((t) => `${state.cards.find((c) => c.id === t.id)?.name ?? t.id} Lv${t.level}`).join(' · ') || '空预设'
    card.append(name, summary); button(card, `载入${preset.name}预购`, () => actions.apply(preset.id), !state.canUse); button(card, `编辑${preset.name}`, () => actions.edit(preset.id)); button(card, `导出${preset.name}`, () => actions.export(preset.id)); presets.append(card)
  }
  root.append(presets)
  const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true; importInput.setAttribute('aria-label', '导入升级预设文件'); importInput.onchange = () => { const file = importInput.files?.[0]; if (file) actions.import(file); importInput.value = '' }
  button(root, '导入升级预设', () => importInput.click()); root.append(importInput); button(root, '新建预设', actions.fresh)
  heading(state.editing ? '编辑预设' : '新预设')
  const nameLabel = document.createElement('label'); nameLabel.className = 'plan-field'; nameLabel.textContent = '预设名称'
  const name = document.createElement('input'); name.type = 'text'; name.maxLength = 40; name.value = state.draft.name; name.setAttribute('aria-label', '预设名称'); name.oninput = () => actions.name(name.value); nameLabel.append(name); root.append(nameLabel)
  const targets = document.createElement('div')
  for (const [index, target] of state.draft.targets.entries()) {
    const row = document.createElement('label'); row.className = 'plan-field'; const label = state.cards.find((c) => c.id === target.id)?.name ?? target.id; row.textContent = label
    row.prepend(document.createTextNode(`${index + 1}. `))
    const level = document.createElement('input'); level.type = 'number'; level.min = '0'; level.step = '1'; level.value = String(target.level); level.setAttribute('aria-label', `第${index + 1}项${label}目标等级`); level.onchange = () => actions.target(index, Number(level.value)); row.append(level)
    button(row, `上移第${index + 1}项`, () => actions.moveTarget(index, -1), index === 0); button(row, `下移第${index + 1}项`, () => actions.moveTarget(index, 1), index === state.draft.targets.length - 1)
    button(row, `移除第${index + 1}项${label}`, () => actions.target(index, 0)); targets.append(row)
  }
  root.append(targets)
  const add = document.createElement('div'); add.className = 'save-slot__actions'; const choice = select('添加预设卡片', state.cards[0]?.id ?? null, add)
  button(add, '追加一次升级', () => actions.add(choice.value)); root.append(add)
  button(root, '使用当前构筑', actions.capture, !state.canUse); button(root, state.editing ? '保存预设修改' : '保存新预设', actions.save)
  return root
}
export type { UpgradeTarget }
