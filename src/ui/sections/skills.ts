import type { SkillView } from '../../core/snapshot'
import type { SkillId } from '../../core/world'
import { SKILL_NAMES, SKILL_DESCRIPTIONS } from '../../content/skills'
export interface SkillsState { readonly skillSlots: readonly (SkillId | null)[]; readonly knownSkills: readonly SkillView[] }
export function renderSkillsSection(state: SkillsState, onEquip: (slot: number, id: SkillId | null) => void): HTMLElement {
  const root = document.createElement('section'); root.className = 'skills-page'
  const intro = document.createElement('p'); intro.className = 'cards__intro'
  intro.textContent = '可拥有多个主动技能，同时只携带两个。J / K 或触屏按钮使用；换装保留各技能冷却，卸下会结束主动效果。'
  root.append(intro)
  const slots = document.createElement('div'); slots.className = 'skills__slots'
  for (const slot of [0, 1]) {
    const id = state.skillSlots[slot], box = document.createElement('article'); box.className = 'skill-slot'
    const heading = document.createElement('h3'); heading.textContent = `${slot + 1} · ${slot === 0 ? 'J' : 'K'} — ${id ? SKILL_NAMES[id] : '未装备'}`
    box.append(heading)
    if (id) { const clear = document.createElement('button'); clear.className = 'settings__option'; clear.textContent = `卸下槽位 ${slot + 1}`; clear.onclick = () => onEquip(slot, null); box.append(clear) }
    slots.append(box)
  }
  root.append(slots)
  const heading = document.createElement('h3'); heading.textContent = '已拥有的主动技能'; root.append(heading)
  if (!state.knownSkills.length) { const hint = document.createElement('p'); hint.textContent = '在升级面板购买偏转力场、狂暴或冲刺后，即可在这里装备。'; root.append(hint) }
  for (const skill of state.knownSkills) {
    if (!skill.id) continue
    const id = skill.id, box = document.createElement('article'); box.className = 'skill-owned'
    const title = document.createElement('h3'); title.textContent = SKILL_NAMES[id]
    const description = document.createElement('p'); description.textContent = SKILL_DESCRIPTIONS[id]
    const status = document.createElement('p'); status.className = 'settings__hint'; status.textContent = `当前冷却 ${skill.cooldown.toFixed(1)} / ${skill.total.toFixed(1)} 秒${skill.active ? ' · 生效中' : ''}`
    box.append(title, description, status)
    for (const slot of [0, 1]) { const button = document.createElement('button'); button.className = 'settings__option'; button.textContent = `将${SKILL_NAMES[id]}装入槽位 ${slot + 1}`; button.disabled = state.skillSlots[slot] === id; button.onclick = () => onEquip(slot, id); box.append(button) }
    root.append(box)
  }
  return root
}
