import type { DuelState } from '../app/modes/duel'
interface Actions { host(): void; join(code: string): void; accept(code: string): void; ready(): void; forfeit(): void; leave(): void; retry(): void }
export function createDuelPanel(root: HTMLElement, actions: Actions) {
  const layer = document.createElement('section'); layer.className = 'duel-layer'; layer.setAttribute('aria-label', '联网 1v1')
  const lobby = document.createElement('div'); lobby.className = 'duel-lobby'
  const title = document.createElement('h1'); title.textContent = '联网 1v1'
  const description = document.createElement('p'); description.textContent = '邀请一位朋友，使用相同装备对决。先赢两回合获胜，双方准备后开始。'
  const status = document.createElement('p'); status.className = 'duel-connection'; status.setAttribute('role', 'status'); status.textContent = '选择创建或加入对局。'
  const choices = document.createElement('div'); choices.className = 'save-slot__actions'
  const button = (text: string, click: () => void, parent: HTMLElement) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'settings__option'; b.textContent = text; b.onclick = click; parent.append(b); return b }
  const hostButton = button('创建对局', actions.host, choices)
  const joinButton = button('加入对局', () => { hostBox.hidden = true; joinBox.hidden = false; choices.hidden = true }, choices)
  const field = (label: string, parent: HTMLElement, readOnly = false) => { const wrap = document.createElement('label'); wrap.className = 'duel-code'; wrap.textContent = label; const area = document.createElement('textarea'); area.rows = 3; area.readOnly = readOnly; area.spellcheck = false; area.setAttribute('aria-label', label); wrap.append(area); parent.append(wrap); return area }
  const copy = (area: HTMLTextAreaElement, label: string, parent: HTMLElement) => button(label, async () => { try { await navigator.clipboard.writeText(area.value); status.textContent = '已复制，请发给对手。' } catch { area.focus(); area.select(); status.textContent = '请手动复制已选中的代码。' } }, parent)
  const hostBox = document.createElement('div'); hostBox.hidden = true
  const hostSteps = document.createElement('p'); hostSteps.textContent = '① 发送邀请代码给朋友 → ② 朋友生成回应代码 → ③ 粘贴回应，连接对局。'; hostBox.append(hostSteps)
  const inviteOut = field('邀请代码', hostBox, true); const copyInvite = copy(inviteOut, '复制邀请代码', hostBox); copyInvite.disabled = true
  const answerIn = field('对手的回应代码', hostBox); const acceptButton = button('连接玩家', () => actions.accept(answerIn.value), hostBox)
  const joinBox = document.createElement('div'); joinBox.hidden = true
  const joinSteps = document.createElement('p'); joinSteps.textContent = '① 粘贴房主的邀请代码 → ② 生成回应 → ③ 把回应代码发回房主，等待连接。'; joinBox.append(joinSteps)
  const inviteIn = field('房主的邀请代码', joinBox); const answerButton = button('生成回应代码', () => actions.join(inviteIn.value), joinBox)
  const answerOut = field('回应代码', joinBox, true); const copyAnswer = copy(answerOut, '复制回应代码', joinBox); copyAnswer.disabled = true
  const footer = document.createElement('div'); footer.className = 'save-slot__actions'; button('重新配对', actions.retry, footer); button('返回主菜单', actions.leave, footer)
  const note = document.createElement('p'); note.className = 'settings__hint'; note.textContent = '请只把连接代码发给本次对手。双方保持页面前台；部分校园网、公司网或移动网络可能无法直连，可尝试同一网络或更换网络。联网对局不支持存档，也不会覆盖单人构筑。'
  lobby.append(title, description, status, choices, hostBox, joinBox, footer, note)
  const hud = document.createElement('div'); hud.className = 'duel-hud'; hud.hidden = true
  const score = document.createElement('strong'), time = document.createElement('span'), latency = document.createElement('span'); hud.append(score, time, latency)
  const roundBox = document.createElement('div'); roundBox.className = 'duel-round'; roundBox.hidden = true
  const roundTitle = document.createElement('h2'), roundText = document.createElement('p'); const ready = button('准备', actions.ready, roundBox); roundBox.prepend(roundTitle, roundText)
  const menu = document.createElement('div'); menu.className = 'duel-menu'; menu.hidden = true
  const menuTitle = document.createElement('h2'); menuTitle.textContent = '对局菜单'; const menuNote = document.createElement('p'); menuNote.textContent = '联网战斗继续进行，不会暂停。'; menu.append(menuTitle, menuNote)
  button('返回战斗', () => { menu.hidden = true }, menu); button('认输本场对局', () => { actions.forfeit(); menu.hidden = true }, menu); button('离开对局', actions.leave, menu)
  layer.append(lobby, hud, roundBox, menu); root.append(layer)
  const showLobby = (text: string, role: 'host' | 'guest' | null, busy = false, code?: string) => {
    lobby.hidden = false; hud.hidden = true; roundBox.hidden = true; menu.hidden = true; status.textContent = text
    hostButton.disabled = busy; joinButton.disabled = busy; answerButton.disabled = busy; acceptButton.disabled = busy
    choices.hidden = role !== null; hostBox.hidden = role !== 'host'; joinBox.hidden = role !== 'guest'
    if (code !== undefined && role === 'host') { inviteOut.value = code; copyInvite.disabled = !code }
    if (code !== undefined && role === 'guest') { answerOut.value = code; copyAnswer.disabled = !code }
  }
  return {
    showLobby,
    showState: (state: DuelState, seat: 0 | 1, ping: number) => {
      lobby.hidden = true; hud.hidden = false
      score.textContent = `你 ${state.wins[seat]} : ${state.wins[1 - seat]} 对手`; time.textContent = `第 ${Math.max(1, state.round)} 回合 · ${Math.ceil(state.remaining / 60)} 秒`; latency.textContent = `已连接 · ${Math.round(ping)} ms`
      roundBox.hidden = state.phase === 'fighting'
      ready.hidden = state.phase === 'countdown'; ready.disabled = state.ready[seat]
      ready.textContent = state.ready[seat] ? '已准备，等待对手' : state.phase === 'finished' ? '准备再战' : state.phase === 'round-over' ? '准备下一回合' : '准备'
      roundTitle.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdown / 60))) : state.phase === 'preparing' ? '准备对战' : state.winner === 'draw' ? '本回合平局' : state.winner === seat ? state.phase === 'finished' ? '你赢得对局' : '你赢下本回合' : state.phase === 'finished' ? '本局落败' : '对手赢下本回合'
      roundText.textContent = state.phase === 'countdown' ? '战斗即将开始' : '相同标准装备 · 枪、地雷、偏转与冲刺 · 双方准备后开战'
    },
    toggleMenu: () => { if (lobby.hidden) menu.hidden = !menu.hidden },
    menuOpen: () => !menu.hidden,
    dispose: () => layer.remove(),
  }
}
