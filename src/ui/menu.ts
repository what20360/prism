import { renderSkillsSection, type SkillsState } from './sections/skills'
import type { SkillId } from '../core/world'
import { renderAttrsSection, type PlayerView } from './sections/attrs'
import { renderCardsSection, type CardsSectionState } from './sections/cards'
import { renderHelpSection } from './sections/help'
import { renderKeysSection } from './sections/keys'
import { renderSettingsSection } from './sections/settings'
import type { ControlSettings, SettingKey } from '../storage/config'

export type MenuSection = 'help' | 'keys' | 'upgrade' | 'attrs' | 'settings' | 'skills'

export interface MenuState extends CardsSectionState, SkillsState {
  readonly player: PlayerView
  readonly settings: ControlSettings
}

export interface MenuHandlers {
  readonly onClose: () => void
  readonly onRestart: () => void
  readonly onBuy: (cardId: string) => void
  readonly onSell: (cardId: string) => void
  readonly onEquip: (slot: number, id: SkillId | null) => void
  readonly onSetting: <K extends SettingKey>(key: K, value: ControlSettings[K]) => void
  readonly getState: () => MenuState
}

export interface Menu {
  open(): void
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
  actions.append(resume, restart)
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
    content.replaceChildren()

    if (active === 'help') content.append(renderHelpSection())
    else if (active === 'keys') content.append(renderKeysSection())
    else if (active === 'skills') content.append(renderSkillsSection(state, handlers.onEquip))
    else if (active === 'attrs') content.append(renderAttrsSection(state.player))
    else if (active === 'settings') {
      content.append(renderSettingsSection(state.settings, { onSetting: handlers.onSetting }, state.player.attrs))
    } else content.append(renderCardsSection(state, { onBuy: handlers.onBuy, onSell: handlers.onSell, collapsed }))

    for (const [id, button] of buttons) {
      button.classList.toggle('menu__tab--active', id === active)
      button.setAttribute('aria-current', id === active ? 'page' : 'false')
    }
  }

  const select = (section: MenuSection): void => {
    active = section
    render()
    content.scrollTop = 0
  }

  const open = (): void => {
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
