import type { AttrSet } from '../core/attrs'
import type { ControlSettings, SettingKey } from '../storage/config'
import { renderHelpSection } from './sections/help'
import { renderSettingsSection } from './sections/settings'
export interface HomeState { readonly canResume: boolean; readonly practice: boolean; readonly settings: ControlSettings; readonly attrs: AttrSet }
export interface HomeHandlers {
  readonly getState: () => HomeState
  readonly onDungeon: () => void
  readonly onPractice: () => void
  readonly onResume: () => void
  readonly onSetting: <K extends SettingKey>(key: K, value: ControlSettings[K]) => void
}
export interface HomeMenu { show(): void; hide(): void; refresh(): void; dispose(): void }
export function createHomeMenu(root: HTMLElement, handlers: HomeHandlers): HomeMenu {
  const overlay = document.createElement('main'); overlay.className = 'home-menu'; overlay.hidden = true; overlay.setAttribute('aria-label', 'PRISM 主菜单')
  const header = document.createElement('header'); header.className = 'home__header'
  const mark = document.createElement('span'); mark.className = 'home__mark'; mark.textContent = 'P R I S M'; header.append(mark)
  const navigation = document.createElement('nav'); navigation.className = 'home__nav'; navigation.setAttribute('aria-label', '主菜单导航'); header.append(navigation)
  const content = document.createElement('div'); content.className = 'home__content'; overlay.append(header, content); root.append(overlay)
  let page: 'hub' | 'help' | 'settings' = 'hub'
  const tabs = new Map<string, HTMLButtonElement>()
  const select = (next: typeof page) => { page = next; render(); content.scrollTop = 0 }
  for (const [id, label] of [['hub', '主页'], ['help', '帮助'], ['settings', '设置']] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = () => select(id); navigation.append(button); tabs.set(id, button)
  }
  const action = (title: string, description: string, className: string, run: () => void): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `home__action ${className}`
    const name = document.createElement('strong'); name.textContent = title
    const text = document.createElement('span'); text.textContent = description
    const arrow = document.createElement('span'); arrow.className = 'home__arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true')
    button.append(name, text, arrow); button.onclick = run; return button
  }
  const render = () => {
    const state = handlers.getState(); content.replaceChildren()
    for (const [id, button] of tabs) button.setAttribute('aria-current', id === page ? 'page' : 'false')
    content.classList.toggle('home__content--page', page !== 'hub')
    if (page === 'help') { content.append(renderHelpSection()); return }
    if (page === 'settings') { const title = document.createElement('h1'); title.textContent = '设置'; content.append(title, renderSettingsSection(state.settings, { onSetting: handlers.onSetting }, state.attrs)); return }
    const hero = document.createElement('section'); hero.className = 'home__hero'
    const eyebrow = document.createElement('p'); eyebrow.className = 'home__eyebrow'; eyebrow.textContent = '几何地牢 · 局内构筑'
    const emblem = document.createElement('div'); emblem.className = 'home__prism'; emblem.setAttribute('aria-hidden', 'true'); emblem.innerHTML = '<span></span><i></i><b></b>'
    const title = document.createElement('h1'); title.textContent = 'PRISM'
    const tagline = document.createElement('p'); tagline.className = 'home__tagline'; tagline.textContent = '选择你的战斗方式。'
    const description = document.createElement('p'); description.className = 'home__description'; description.textContent = '穿越五层地牢，组合弹道与雷场，用自己的构筑击败棱镜核心。'
    hero.append(eyebrow, emblem, title, tagline, description)
    const actions = document.createElement('section'); actions.className = 'home__actions'; actions.setAttribute('aria-label', '游戏入口')
    if (state.canResume) actions.append(action('继续本局', state.practice ? '返回当前测试场，保留构筑与场景' : '从暂停处继续闯关', 'home__action--resume', handlers.onResume))
    actions.append(action('开始闯关', '从安全房出发，探索地牢与构筑', 'home__action--primary', handlers.onDungeon), action('测试模式', '自由构筑 · 靶机测试 · 敌人演练', 'home__action--practice', handlers.onPractice))
    const note = document.createElement('p'); note.className = 'home__note'; note.textContent = 'WASD 移动 · 左键射击 · 右键锁定 · Esc 暂停\n手机使用双摇杆与独立技能按钮。设置自动保存，局内进度不保存。'
    actions.append(note); content.append(hero, actions)
  }
  const onKey = (event: KeyboardEvent) => { if (!overlay.hidden && event.code === 'Escape' && page !== 'hub') { select('hub'); event.preventDefault() } }
  window.addEventListener('keydown', onKey)
  return { show: () => { page = 'hub'; overlay.hidden = false; render() }, hide: () => { overlay.hidden = true }, refresh: () => { if (!overlay.hidden) render() }, dispose: () => { window.removeEventListener('keydown', onKey); overlay.remove() } }
}
