import type { AttrSet } from '../core/attrs'
import type { ControlSettings, SettingKey } from '../storage/config'
import { renderHelpSection } from './sections/help'
import { renderSettingsSection } from './sections/settings'
import { worldSeed } from '../app/modes/endless'
import { renderSavesSection, type SavesHandlers, type SavesState } from './sections/saves'
import { renderPlansSection, type PlansHandlers, type PlanView } from './sections/plans'
export interface HomeState { readonly canResume: boolean; readonly practice: boolean; readonly endless?: boolean; readonly settings: ControlSettings; readonly attrs: AttrSet }
export interface HomeHandlers {
  readonly saves?: SavesHandlers
  readonly getSaves?: () => SavesState
  readonly onDuel?: () => void
  readonly plans?: PlansHandlers
  readonly getPlans?: () => PlanView
  readonly getState: () => HomeState
  readonly onDungeon: () => void
  readonly onPractice: () => void
  readonly onEndless: (seed: number) => void
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
  let page: 'hub' | 'help' | 'settings' | 'saves' | 'plans' = 'hub'
  let seedText = '20261030'
  const tabs = new Map<string, HTMLButtonElement>()
  const select = (next: typeof page) => { page = next; render(); content.scrollTop = 0 }
  for (const [id, label] of [['hub', '主页'], ['help', '帮助'], ['settings', '设置'], ['saves', '存档'], ['plans', '预设']] as const) {
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
    if (page === 'saves' && handlers.saves && handlers.getSaves) { content.append(renderSavesSection(handlers.getSaves(), handlers.saves)); return }
    if (page === 'plans' && handlers.plans && handlers.getPlans) { content.append(renderPlansSection(handlers.getPlans(), handlers.plans)); return }
    if (page === 'settings') { const title = document.createElement('h1'); title.textContent = '设置'; content.append(title, renderSettingsSection(state.settings, { onSetting: handlers.onSetting }, state.attrs)); return }
    const hero = document.createElement('section'); hero.className = 'home__hero'
    const eyebrow = document.createElement('p'); eyebrow.className = 'home__eyebrow'; eyebrow.textContent = '几何地牢 · 局内构筑'
    const emblem = document.createElement('div'); emblem.className = 'home__prism'; emblem.setAttribute('aria-hidden', 'true'); emblem.innerHTML = '<span></span><i></i><b></b>'
    const title = document.createElement('h1'); title.textContent = 'PRISM'
    const tagline = document.createElement('p'); tagline.className = 'home__tagline'; tagline.textContent = '选择你的战斗方式。'
    const description = document.createElement('p'); description.className = 'home__description'; description.textContent = '闯入地牢或探索无尽世界，组合弹道与雷场，打造自己的构筑。'
    hero.append(eyebrow, emblem, title, tagline, description)
    const actions = document.createElement('section'); actions.className = 'home__actions'; actions.setAttribute('aria-label', '游戏入口')
    if (state.canResume) actions.append(action('继续本局', state.practice ? '返回当前测试场，保留构筑与场景' : state.endless ? '继续当前种子的无尽探索' : '从暂停处继续闯关', 'home__action--resume', handlers.onResume))
    actions.append(action('开始闯关', '从安全房出发，探索地牢与构筑', 'home__action--primary', handlers.onDungeon), action('测试模式', '自由构筑 · 靶机测试 · 敌人演练', 'home__action--practice', handlers.onPractice))
    const seedLabel = document.createElement('label'); seedLabel.className = 'home__seed'; seedLabel.textContent = '无尽世界种子'
    const seed = document.createElement('input'); seed.type = 'text'; seed.value = seedText; seed.maxLength = 80; seed.setAttribute('aria-label', '无尽世界种子'); seed.oninput = () => { seedText = seed.value }; seedLabel.append(seed)
    actions.append(seedLabel, action('无尽模式', '种子生成 · 清场推进 · 每五层可跳过战斗', 'home__action--endless', () => handlers.onEndless(worldSeed(seed.value))))
    if (handlers.onDuel) actions.append(action('联网 1v1', '邀请好友 · 标准装备 · 两胜制', 'home__action--duel', handlers.onDuel))
    if (handlers.getSaves?.().slots.find((s) => s.id === 'auto')?.available) actions.append(action('载入自动存档', '恢复上次闯关或无尽进度', 'home__action--resume', () => handlers.saves?.onLoad('auto')))
    const note = document.createElement('p'); note.className = 'home__note'; note.textContent = 'WASD 移动 · 左键射击 · 右键锁定 · Esc 菜单\n手机使用双摇杆。单人进度自动保存，新局更新自动槽；手动存档独立保留。'
    actions.append(note); content.append(hero, actions)
  }
  const onKey = (event: KeyboardEvent) => { if (!overlay.hidden && event.code === 'Escape' && page !== 'hub') { select('hub'); event.preventDefault() } }
  window.addEventListener('keydown', onKey)
  return { show: () => { page = 'hub'; overlay.hidden = false; render() }, hide: () => { overlay.hidden = true }, refresh: () => { if (!overlay.hidden) render() }, dispose: () => { window.removeEventListener('keydown', onKey); overlay.remove() } }
}
