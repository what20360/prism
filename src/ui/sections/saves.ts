export type SlotId = 'auto' | 'slot-1' | 'slot-2' | 'slot-3'
export interface SlotView { readonly id: SlotId; readonly label: string; readonly name?: string; readonly detail: string; readonly savedAt?: string; readonly available: boolean }
export interface SavesState { readonly slots: readonly SlotView[]; readonly canSave: boolean; readonly message: string }
export interface SavesHandlers {
  readonly onExportCurrent: () => void
  readonly onSave: (slot: SlotId) => void; readonly onLoad: (slot: SlotId) => void; readonly onExport: (slot: SlotId) => void
  readonly onImport: (slot: SlotId, file: File) => void
  readonly onRename: (slot: SlotId, name: string) => void
}
export function renderSavesSection(state: SavesState, handlers: SavesHandlers): HTMLElement {
  const root = document.createElement('section'); root.className = 'saves-page'
  const title = document.createElement('h2'); title.textContent = '存档与导入导出'
  const intro = document.createElement('p'); intro.className = 'cards__intro'; intro.textContent = '闯关和无尽模式每 10 秒自动保存，也可手动保存到三个独立槽位。读档后暂停，点击继续再出发。测试场和联网对局不存档。'
  const status = document.createElement('p'); status.className = 'save-status'; status.setAttribute('role', 'status'); status.textContent = state.message
  root.append(title, intro, status)
  const exportCurrent = document.createElement('button'); exportCurrent.type = 'button'; exportCurrent.className = 'settings__option'; exportCurrent.textContent = '导出当前进度'; exportCurrent.disabled = !state.canSave; exportCurrent.onclick = handlers.onExportCurrent; root.append(exportCurrent)
  for (const slot of state.slots) {
    const card = document.createElement('article'); card.className = 'save-slot'
    const name = document.createElement('h3'); name.textContent = slot.name ? `${slot.label} · ${slot.name}` : slot.label
    const detail = document.createElement('p'); detail.textContent = slot.detail
    const date = document.createElement('p'); date.className = 'settings__hint'; date.textContent = slot.savedAt ? new Date(slot.savedAt).toLocaleString() : '尚未保存'
    const actions = document.createElement('div'); actions.className = 'save-slot__actions'
    const button = (label: string, disabled: boolean, run: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'settings__option'; b.textContent = label; b.disabled = disabled; b.onclick = run; actions.append(b) }
    if (slot.id !== 'auto') button(`${slot.available ? '覆盖保存' : '保存到'}${slot.label}`, !state.canSave, () => handlers.onSave(slot.id))
    button(`读取${slot.label}`, !slot.available, () => handlers.onLoad(slot.id))
    button(`导出${slot.label}`, !slot.available, () => handlers.onExport(slot.id))
    if (slot.id !== 'auto') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true; input.setAttribute('aria-label', `导入到${slot.label}`)
      input.onchange = () => { const file = input.files?.[0]; if (file) handlers.onImport(slot.id, file); input.value = '' }
      button(`导入到${slot.label}`, false, () => input.click()); actions.append(input)
    }
    card.append(name, detail, date, actions); root.append(card)
    if (slot.available) {
      const rename = document.createElement('form'); rename.className = 'save-rename'
      const label = document.createElement('label'); label.textContent = '存档名'
      const field = document.createElement('input'); field.type = 'text'; field.maxLength = 40; field.required = true; field.value = slot.name ?? slot.label; field.setAttribute('aria-label', `${slot.label}名称`); label.append(field)
      const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'settings__option'; apply.textContent = `重命名${slot.label}`
      rename.onsubmit = (event) => { event.preventDefault(); if (field.reportValidity()) handlers.onRename(slot.id, field.value) }; rename.append(label, apply); card.append(rename)
    }
  }
  const note = document.createElement('p'); note.className = 'settings__hint'; note.textContent = '可重命名已有存档，覆盖保存/导入保留所选槽位原名；导入空槽使用文件中的名称，导出文件包含存档名。存档保存在当前浏览器，清理网站数据会移除它们。导入读取后才替换当前局，控制与声音设置继续使用本机偏好。'
  root.append(note); return root
}
