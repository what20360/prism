import { DUEL_MODES, type DuelMode, type DuelState } from '../content/duel'
import type { PanelState } from '../app/game'
import type { PlanView, PlansHandlers } from './sections/plans'
import type { SkillId } from '../core/world'
import { renderCardsSection } from './sections/cards'
import { renderSkillsSection } from './sections/skills'
import { renderPlansSection } from './sections/plans'
interface Actions {
  host(mode: DuelMode): void; join(code: string): void; accept(code: string): void; ready(): void; forfeit(): void; leave(): void; retry(): void
  shop(): PanelState | undefined; buy(id: string): void; sell(id: string): void; equip(slot: number, id: SkillId | null): void; queue(id: string): void
  favorites(): readonly string[]; favorite(id: string): void; plans: PlansHandlers; getPlans(): PlanView
}
export function createDuelPanel(root: HTMLElement, actions: Actions) {
  const layer = document.createElement('section'); layer.className = 'duel-layer'; layer.setAttribute('aria-label', '联网 1v1')
  const button = (text: string, click: () => void, parent: HTMLElement) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'settings__option'; b.textContent = text; b.onclick = click; parent.append(b); return b }
  const lobby = document.createElement('div'); lobby.className = 'duel-lobby'
  const title = document.createElement('h1'); title.textContent = '联网 1v1'
  const description = document.createElement('p'); description.textContent = '选择对战规则，邀请一位朋友。先赢两回合获胜，双方准备后开始。'
  const modeBox = document.createElement('fieldset'); modeBox.className = 'duel-modes'; const legend = document.createElement('legend'); legend.textContent = '房主选择对战模式'; modeBox.append(legend)
  let selected: DuelMode = 'fixed'
  for (const [id, spec] of Object.entries(DUEL_MODES) as [DuelMode, typeof DUEL_MODES[DuelMode]][]) {
    const label = document.createElement('label'), radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'duel-mode'; radio.value = id; radio.checked = id === selected; radio.setAttribute('aria-label', spec.name); radio.onchange = () => { selected = id }
    const heading = document.createElement('strong'); heading.textContent = spec.name; const text = document.createElement('span'); text.textContent = spec.description; label.append(radio, heading, text); modeBox.append(label)
  }
  const status = document.createElement('p'); status.className = 'duel-connection'; status.setAttribute('role', 'status'); status.textContent = '选择创建或加入对局。'
  const choices = document.createElement('div'); choices.className = 'save-slot__actions'
  const hostButton = button('创建对局', () => actions.host(selected), choices)
  const joinButton = button('加入对局', () => { hostBox.hidden = true; joinBox.hidden = false; choices.hidden = true; modeBox.hidden = true }, choices)
  const field = (label: string, parent: HTMLElement, readOnly = false) => { const wrap = document.createElement('label'); wrap.className = 'duel-code'; wrap.textContent = label; const area = document.createElement('textarea'); area.rows = 3; area.readOnly = readOnly; area.spellcheck = false; area.setAttribute('aria-label', label); wrap.append(area); parent.append(wrap); return area }
  const copy = (area: HTMLTextAreaElement, label: string, parent: HTMLElement) => button(label, async () => { try { await navigator.clipboard.writeText(area.value); status.textContent = '已复制，请发给对手。' } catch { area.focus(); area.select(); status.textContent = '请手动复制已选中的代码。' } }, parent)
  const hostBox = document.createElement('div'); hostBox.hidden = true
  const hostSteps = document.createElement('p'); hostSteps.textContent = '① 发送邀请代码给朋友 → ② 朋友生成回应代码 → ③ 粘贴回应，连接对局。'; hostBox.append(hostSteps)
  const inviteOut = field('邀请代码', hostBox, true); const copyInvite = copy(inviteOut, '复制邀请代码', hostBox); copyInvite.disabled = true
  const answerIn = field('对手的回应代码', hostBox); const acceptButton = button('连接玩家', () => actions.accept(answerIn.value), hostBox)
  const joinBox = document.createElement('div'); joinBox.hidden = true
  const joinSteps = document.createElement('p'); joinSteps.textContent = '① 粘贴房主的邀请代码 → ② 生成回应 → ③ 把回应代码发回房主，等待连接。连接后显示房主选择的规则。'; joinBox.append(joinSteps)
  const inviteIn = field('房主的邀请代码', joinBox); const answerButton = button('生成回应代码', () => actions.join(inviteIn.value), joinBox)
  const answerOut = field('回应代码', joinBox, true); const copyAnswer = copy(answerOut, '复制回应代码', joinBox); copyAnswer.disabled = true
  const footer = document.createElement('div'); footer.className = 'save-slot__actions'; button('重新配对', actions.retry, footer); button('返回主菜单', actions.leave, footer)
  const note = document.createElement('p'); note.className = 'settings__hint'; note.textContent = '请只把连接代码发给本次对手。双方保持页面前台；部分校园网、公司网或移动网络可能无法直连，可尝试同一网络或更换网络。联网对局不支持存档，也不会覆盖单人构筑。'
  lobby.append(title, description, modeBox, status, choices, hostBox, joinBox, footer, note)
  const hud = document.createElement('div'); hud.className = 'duel-hud'; hud.hidden = true
  const score = document.createElement('strong'), time = document.createElement('span'), rule = document.createElement('span'), latency = document.createElement('span'); hud.append(score, time, rule, latency)
  const shopButton = button('购买与构筑', () => openShop('cards'), hud); shopButton.classList.add('duel-shop-button')
  button('对局菜单', () => { menu.hidden = !menu.hidden }, hud).classList.add('duel-shop-button')
  const roundBox = document.createElement('div'); roundBox.className = 'duel-round'; roundBox.hidden = true
  const roundTitle = document.createElement('h2'), roundText = document.createElement('p'); const ready = button('准备', actions.ready, roundBox); roundBox.prepend(roundTitle, roundText)
  const menu = document.createElement('div'); menu.className = 'duel-menu'; menu.hidden = true
  const menuTitle = document.createElement('h2'); menuTitle.textContent = '对局菜单'; const menuNote = document.createElement('p'); menuNote.textContent = '联网战斗继续进行，不会暂停。'; menu.append(menuTitle, menuNote)
  button('返回战斗', () => { menu.hidden = true }, menu); button('认输本场对局', () => { actions.forfeit(); menu.hidden = true }, menu); button('离开对局', actions.leave, menu)
  const shop = document.createElement('div'); shop.className = 'duel-shop'; shop.hidden = true
  const shopHeader = document.createElement('div'); shopHeader.className = 'duel-shop__header'; const shopTitle = document.createElement('h2'); shopTitle.textContent = '对战构筑'; shopHeader.append(shopTitle)
  const budget = document.createElement('p'); budget.className = 'settings__hint'; shopHeader.append(budget)
  const nav = document.createElement('nav'); shopHeader.append(nav)
  const content = document.createElement('div'); content.className = 'duel-shop__content'; const collapsed = new Set<string>()
  let active: 'cards' | 'skills' | 'plans' = 'cards', shopSignature = ''
  for (const [id, label] of [['cards', '升级卡片'], ['skills', '主动技能'], ['plans', '流派与预购']] as const) button(label, () => { active = id; refreshShop(true) }, nav)
  button('返回对局', () => { shop.hidden = true }, nav); shop.append(shopHeader, content)
  const refreshShop = (force = false) => {
    if (shop.hidden) return
    const view = actions.shop(); if (!view) { shop.hidden = true; return }
    budget.textContent = `可用棱晶 ${Math.floor(view.shards)} · 战斗中打开此页不会暂停；准备后不能修改构筑。`
    const signature = JSON.stringify([active, view.cards, view.skillSlots, actions.favorites(), active === 'plans' ? actions.getPlans() : null])
    if (!force && (signature === shopSignature || content.contains(document.activeElement) && document.activeElement?.matches('input, textarea, select'))) return
    shopSignature = signature; const scroll = content.scrollTop
    if (active === 'cards') content.replaceChildren(renderCardsSection(view, { onBuy: actions.buy, onSell: actions.sell, onQueue: (id) => { actions.queue(id); openShop('plans') }, favorites: actions.favorites(), onFavorite: actions.favorite, collapsed }))
    else if (active === 'skills') content.replaceChildren(renderSkillsSection(view, actions.equip))
    else content.replaceChildren(renderPlansSection(actions.getPlans(), actions.plans))
    content.scrollTop = scroll
  }
  const openShop = (page: typeof active) => { menu.hidden = true; active = page; shop.hidden = false; refreshShop(true) }
  layer.append(lobby, hud, roundBox, menu, shop); root.append(layer)
  return {
    showLobby: (text: string, role: 'host' | 'guest' | null, busy = false, code?: string) => {
      lobby.hidden = false; hud.hidden = true; roundBox.hidden = true; menu.hidden = true; shop.hidden = true; status.textContent = text
      hostButton.disabled = busy; joinButton.disabled = busy; answerButton.disabled = busy; acceptButton.disabled = busy
      modeBox.hidden = role === 'guest'; modeBox.disabled = role !== null; choices.hidden = role !== null; hostBox.hidden = role !== 'host'; joinBox.hidden = role !== 'guest'
      if (code !== undefined && role === 'host') { inviteOut.value = code; copyInvite.disabled = !code }
      if (code !== undefined && role === 'guest') { answerOut.value = code; copyAnswer.disabled = !code }
    },
    showState: (state: DuelState, seat: 0 | 1, ping: number) => {
      lobby.hidden = true; hud.hidden = false; modeBox.disabled = true
      score.textContent = `你 ${state.wins[seat]} : ${state.wins[1 - seat]} 对手`; time.textContent = `第 ${Math.max(1, state.round)} 回合 · ${Math.ceil(state.remaining / 60)} 秒`; latency.textContent = `已连接 · ${Math.round(ping)} ms`
      rule.textContent = DUEL_MODES[state.mode].name; shopButton.hidden = state.mode === 'fixed' || state.phase === 'finished'; shopButton.disabled = state.phase === 'countdown' || state.ready[seat]
      if (state.phase === 'countdown' || state.phase === 'finished') shop.hidden = true
      roundBox.hidden = state.phase === 'fighting' || !shop.hidden
      ready.hidden = state.phase === 'countdown'; ready.disabled = state.ready[seat]
      ready.textContent = state.ready[seat] ? '已准备，等待对手' : state.phase === 'finished' ? '准备再战' : state.phase === 'round-over' ? '准备下一回合' : '准备'
      roundTitle.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdown / 60))) : state.phase === 'preparing' ? '准备对战' : state.winner === 'draw' ? '本回合平局' : state.winner === seat ? state.phase === 'finished' ? '你赢得对局' : '你赢下本回合' : state.phase === 'finished' ? '本局落败' : '对手赢下本回合'
      roundText.textContent = state.phase === 'countdown' ? '战斗即将开始' : state.mode === 'fixed' ? '相同标准装备 · 枪、地雷、偏转与冲刺' : `${DUEL_MODES[state.mode].description} 准备前可购买升级；下一回合重置经济与构筑。`
      refreshShop()
    },
    refresh: () => refreshShop(true),
    toggleMenu: () => { if (!shop.hidden) shop.hidden = true; else if (lobby.hidden) menu.hidden = !menu.hidden },
    menuOpen: () => !menu.hidden || !shop.hidden,
    dispose: () => layer.remove(),
  }
}
