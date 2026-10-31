import { renderEndlessSection } from './sections/endless'
import { renderSavesSection, type SavesHandlers, type SavesState } from './sections/saves'
import { renderPlansSection, type PlansHandlers, type PlanView } from './sections/plans'
import type { EndlessState } from '../app/modes/endless'
import { renderPracticeSection } from './sections/practice'
import type { PracticeState, PracticeAction } from '../app/modes/practice'
import { renderSkillsSection, type SkillsState } from './sections/skills'
import type { SkillId } from '../core/world'
import { renderAttrsSection, type PlayerView } from './sections/attrs'
import { renderCardsSection, type CardsSectionState } from './sections/cards'
import { renderHelpSection } from './sections/help'
import { renderKeysSection } from './sections/keys'
import { renderSettingsSection } from './sections/settings'
import type { ControlSettings, SettingKey } from '../storage/config'
import { renderDungeonSection } from './sections/dungeon'
import type { DungeonDifficulty } from '../content/difficulties'

export type MenuSection = 'help' | 'keys' | 'upgrade' | 'attrs' | 'settings' | 'skills' | 'practice' | 'endless' | 'saves' | 'plans' | 'dungeon'

export interface MenuState extends CardsSectionState, SkillsState {
  readonly dungeon?: { readonly difficulty: DungeonDifficulty; readonly seed: number; readonly wave: number; readonly waves: number }
  readonly player: PlayerView
  readonly settings: ControlSettings
  readonly endless?: EndlessState
  readonly practice?: PracticeState
}

export interface MenuHandlers {
  readonly favorites?: () => readonly string[]
  readonly onFavorite?: (id: string) => void
  readonly saves?: SavesHandlers
  readonly getSaves?: () => SavesState
  readonly plans?: PlansHandlers
  readonly getPlans?: () => PlanView
  readonly onQueue?: (id: string) => void
  readonly onClose: () => void
  readonly onRestart: () => void
  readonly onHome: () => void
  readonly onPractice: (action: PracticeAction) => void
  readonly onBuy: (cardId: string) => void
  readonly onSell: (cardId: string) => void
  readonly onEquip: (slot: number, id: SkillId | null) => void
  readonly onSetting: <K extends SettingKey>(key: K, value: ControlSettings[K]) => void
  readonly getState: () => MenuState
}

export interface Menu {
  open(section?: MenuSection): void
  close(): void
  refresh(): void
  readonly visible: boolean
  readonly section: MenuSection
}

const SECTIONS: readonly { id: MenuSection; label: string }[] = [
  { id: 'help', label: '帮助' },
  { id: 'keys', label: '按键绑定' },
  { id: 'upgrade', label: '升级面板' },
  { id: 'attrs', label: '角色属性' },
  { id: 'skills', label: '主动技能' },
  { id: 'settings', label: '设置' },
  { id: 'practice', label: '测试控制' },
  { id: 'endless', label: '无尽状态' },
  { id: 'dungeon', label: '闯关状态' },
  { id: 'saves', label: '存档' },
  { id: 'plans', label: '构筑与预购' },
]

/**
 * Single paused menu: Escape opens it, the left column switches pages and the
 * right column renders the active page. One key instead of one key per panel.
 */
export function createMenu(root: HTMLElement, handlers: MenuHandlers): Menu {
  const overlay = document.createElement('div')
  overlay.className = 'panel panel--menu'
  overlay.hidden = true

  const shell = document.createElement('div')
  shell.className = 'menu'

  const nav = document.createElement('nav')
  nav.className = 'menu__nav'

  const brand = document.createElement('h2')
  brand.className = 'menu__brand'
  brand.textContent = 'PRISM'
  nav.append(brand)

  const buttons = new Map<MenuSection, HTMLButtonElement>()
  for (const section of SECTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu__tab'
    button.textContent = section.label
    button.addEventListener('click', () => select(section.id))
    buttons.set(section.id, button)
    nav.append(button)
  }

  const actions = document.createElement('div')
  actions.className = 'menu__actions'

  const resume = document.createElement('button')
  resume.type = 'button'
  resume.className = 'menu__resume'
  resume.textContent = '继续 (Esc)'
  resume.addEventListener('click', () => handlers.onClose())
  const restart = document.createElement('button')
  restart.type = 'button'
  restart.className = 'menu__restart'
  restart.textContent = '重新开始'
  restart.title = '结束当前局并重新开始'
  restart.addEventListener('click', () => handlers.onRestart())
  const home = document.createElement('button'); home.className = 'menu__resume'; home.textContent = '返回主菜单'; home.onclick = handlers.onHome
  actions.append(resume, restart, home)
  nav.append(actions)

  const content = document.createElement('div')
  content.className = 'menu__content'

  shell.append(nav, content)
  overlay.append(shell)
  root.append(overlay)

  let active: MenuSection = 'upgrade'
  const collapsed = new Set<string>()

  const render = (): void => {
    const state = handlers.getState()
    if ((active === 'practice' && !state.practice) || (active === 'endless' && !state.endless) || (active === 'dungeon' && !state.dungeon)) active = 'upgrade'
    content.replaceChildren()

    if (active === 'dungeon' && state.dungeon) content.append(renderDungeonSection(state.dungeon))
    else if (active === 'plans' && handlers.plans && handlers.getPlans) content.append(renderPlansSection(handlers.getPlans(), handlers.plans))
    else if (active === 'saves' && handlers.saves && handlers.getSaves) content.append(renderSavesSection(handlers.getSaves(), handlers.saves))
    else if (active === 'practice' && state.practice) content.append(renderPracticeSection(state.practice, handlers.onPractice, handlers.onRestart))
    else if (active === 'endless' && state.endless) content.append(renderEndlessSection(state.endless))
    else if (active === 'help') content.append(renderHelpSection())
    else if (active === 'keys') content.append(renderKeysSection())
    else if (active === 'skills') content.append(renderSkillsSection(state, handlers.onEquip))
    else if (active === 'attrs') content.append(renderAttrsSection(state.player))
    else if (active === 'settings') {
      content.append(renderSettingsSection(state.settings, { onSetting: handlers.onSetting }, state.player.attrs))
    } else content.append(renderCardsSection(state, { onBuy: handlers.onBuy, onSell: handlers.onSell, onQueue: handlers.onQueue, collapsed, onPractice: handlers.onPractice, favorites: handlers.favorites?.(), onFavorite: handlers.onFavorite }))

    for (const [id, button] of buttons) {
      button.hidden = (id === 'practice' && !state.practice) || (id === 'endless' && !state.endless) || (id === 'dungeon' && !state.dungeon)
      button.classList.toggle('menu__tab--active', id === active)
      button.setAttribute('aria-current', id === active ? 'page' : 'false')
    }
  }

  const select = (section: MenuSection): void => {
    active = section
    render()
    content.scrollTop = 0
  }

  const open = (section?: MenuSection): void => {
    if (section) active = section
    overlay.hidden = false
    render()
  }

  const close = (): void => {
    overlay.hidden = true
  }

  return {
    open,
    close,
    refresh: () => {
      if (!overlay.hidden) render()
    },
    get visible() {
      return !overlay.hidden
    },
    get section() {
      return active
    },
  }
}
