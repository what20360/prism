import type { BuildPreset, UpgradeTarget } from '../../app/upgradePlans'
export interface PresetView extends BuildPreset { readonly id: string }
export interface PlanView {
  readonly canUse: boolean; readonly cards: readonly { id: string; name: string; level: number }[]
  readonly presets: readonly PresetView[]; readonly draft: BuildPreset; readonly editing: boolean; readonly message: string
  readonly queue: readonly { id: string; name: string; level: number; current: number; price: number; status: string }[]; readonly enabled: boolean
  readonly quickSlots: readonly (string | null)[]
}
export interface PlansHandlers {
  name(value: string): void; target(id: string, level: number): void; quick(slot: number, id: string | null): void
  save(): void; capture(): void; fresh(): void; edit(id: string): void; apply(id: string): void; export(id: string): void; import(file: File): void
  toggle(enabled: boolean): void; move(index: number, direction: -1 | 1): void; remove(index: number): void; queue(id: string, level: number): void
}
export function renderPlansSection(state: PlanView, actions: PlansHandlers): HTMLElement {
  const root = document.createElement('section'); root.className = 'plans-page'
  const title = document.createElement('h2'); title.textContent = '升级预设与预购'
  const note = document.createElement('p'); note.className = 'cards__intro'; note.textContent = '预设保存目标等级，载入后按队列补齐，不会自动卖卡。预购只在单人战斗进行时消费棱晶，前置不足时等待；快捷栏可点击或按数字 1–5 购买一级。'
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
  heading('快捷购买栏')
  const quick = document.createElement('div'); quick.className = 'quick-editor'
  for (let index = 0; index < 5; index++) { const field = select(`快捷位${index + 1}`, state.quickSlots[index] ?? null, quick, true); field.onchange = () => actions.quick(index, field.value || null) }
  root.append(quick)
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
  for (const target of state.draft.targets) {
    const row = document.createElement('label'); row.className = 'plan-field'; const label = state.cards.find((c) => c.id === target.id)?.name ?? target.id; row.textContent = label
    const level = document.createElement('input'); level.type = 'number'; level.min = '0'; level.step = '1'; level.value = String(target.level); level.setAttribute('aria-label', `${label}预设等级`); level.onchange = () => actions.target(target.id, Number(level.value)); row.append(level); button(row, `移除预设中的${label}`, () => actions.target(target.id, 0)); targets.append(row)
  }
  root.append(targets)
  const add = document.createElement('div'); add.className = 'save-slot__actions'; const choice = select('添加预设卡片', state.cards[0]?.id ?? null, add)
  button(add, '添加卡片目标', () => actions.target(choice.value, 1)); root.append(add)
  button(root, '使用当前构筑', actions.capture, !state.canUse); button(root, state.editing ? '保存预设修改' : '保存新预设', actions.save)
  return root
}
export type { UpgradeTarget }
