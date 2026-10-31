import { createDuelPeer, type DuelPeer, type PeerStatus } from '../net/peer'
import { cleanIntent, createRemoteInput, decodePacket, encodePacket, IDLE_INPUT, type DuelPacket } from '../net/protocol'
import { createDuelMatch, DUEL_ATTRS, DUEL_RULES, type DuelMatch, type DuelState } from './modes/duel'
import { restoreWorld, serializeWorld } from '../core/serialization'
import { CARD_REGISTRY } from '../content/cards'
import { DUEL_ECONOMY, type DuelAction, type DuelMode } from '../content/duel'
import { combatAttrs } from '../core/combat'
import { shieldCap } from '../core/attrs'
import { listCardStates } from '../core/progress'
import { SKILL_IDS, unlocked } from '../core/systems/skills'
import { toSkillView } from '../core/snapshot'
import type { PanelState } from './game'
import type { PlanSession } from './planManager'
import type { createPlanManager } from './planManager'
import type { ControlSettings } from '../storage/config'
import { toSnapshot } from '../core/snapshot'
import type { World } from '../core/world'
import type { IntentSource } from '../input/keyboard'
import type { PointerSource } from '../input/pointer'
import type { TouchSource } from '../input/touch'
import type { Renderer } from '../render/canvas2d/renderer'
import { createDuelPanel } from '../ui/duelPanel'
import { readDuelIntent } from './readIntent'
export function createDuelSession(options: { root: HTMLElement; input: IntentSource; pointer: PointerSource; touch: TouchSource; renderer: Renderer; leave: () => void; plans: ReturnType<typeof createPlanManager>; settings: () => ControlSettings; onSnapshot?: (snapshot: ReturnType<typeof toSnapshot>, paused: boolean) => void }) {
  let peer: DuelPeer | undefined, role: 'host' | 'guest' | null = null, connected = false, disposed = false, generation = 0
  let match: DuelMatch | undefined, world: World | undefined, state: DuelState | undefined, lastPhase = '', frame = 0, lastTime = 0, accumulator = 0
  let lastSend = 0, lastInputSend = 0, lastPing = 0, lastSeen = 0, ping = 0, sequence = 0, serial = 0, receivedSerial = -1, actionSequence = 0, receivedAction = -1, selectedMode: DuelMode = 'fixed'
  let remote = createRemoteInput(), connectionTimer: ReturnType<typeof setTimeout> | undefined, windowStart = 0, messageCount = 0
  const resetInput = () => { options.input.reset(); options.pointer.reset(); options.touch.reset() }
  const send = (packet: DuelPacket) => peer?.send(encodePacket(packet)) ?? false
  const showFailure = (message: string) => { connected = false; peer?.close(); peer = undefined; clearTimeout(connectionTimer); resetInput(); options.touch.setPaused(true); panel.showLobby(message, null) }
  const receive = (text: string) => {
    try {
      if (performance.now() - windowStart >= 1000) { windowStart = performance.now(); messageCount = 0 }
      if (++messageCount > 120) { showFailure('消息过于频繁，连接已结束。'); return }
      const packet = decodePacket(text); lastSeen = performance.now()
      if (packet.type === 'ping') { send({ type: 'pong', time: packet.time }); return }
      if (packet.type === 'pong') { ping = Math.max(0, performance.now() - packet.time); return }
      if (role === 'host' && match) {
        if (packet.type === 'input') remote.accept(packet, match.state().round, performance.now())
        else if (packet.type === 'ready') match.ready(1)
        else if (packet.type === 'forfeit') match.forfeit(1)
        else if (packet.type === 'action' && packet.sequence > receivedAction && packet.round === match.state().round) { receivedAction = packet.sequence; match.action(1, packet.action) }
      } else if (role === 'guest' && packet.type === 'state' && packet.serial > receivedSerial) {
        receivedSerial = packet.serial; world = restoreWorld(packet.world, CARD_REGISTRY, DUEL_ECONOMY, Object.keys(DUEL_ATTRS)); state = packet.state
      }
    } catch { showFailure('对战数据或版本不匹配，请双方刷新页面后重新配对。') }
  }
  const status = (value: PeerStatus) => {
    if (disposed) return
    if (value === 'connected') {
      connected = true; clearTimeout(connectionTimer); lastSeen = performance.now(); lastTime = 0; accumulator = 0; resetInput()
      if (role === 'host') { match = createDuelMatch(crypto.getRandomValues(new Uint32Array(1))[0]!, selectedMode); world = match.world(); state = match.state() }
      else panel.showLobby('已连接，正在同步对局。', 'guest', true)
    } else if (value === 'failed' || value === 'disconnected') showFailure('连接已中断，本场对局结束。可重新配对，或尝试同一网络/更换网络。')
    else if (value === 'gathering') panel.showLobby('正在生成连接代码，请稍候……', role, true)
    else if (value === 'connecting') {
      panel.showLobby('正在连接对手……', role, true); clearTimeout(connectionTimer)
      connectionTimer = setTimeout(() => showFailure('未能建立直连。请检查回应代码是否来自本场对局，或更换网络后重试。'), 20000)
    }
  }
  const fresh = (next: 'host' | 'guest') => {
    generation++; peer?.close(); connected = false; role = next; match = undefined; world = undefined; state = undefined
    receivedSerial = -1; actionSequence = 0; receivedAction = -1; sequence = 0; serial = 0; remote = createRemoteInput(); lastPhase = ''; clearTimeout(connectionTimer)
    peer = createDuelPeer({ status, message: receive }); return { token: generation, peer }
  }
  const run = async (kind: 'host' | 'guest', code = '') => {
    let token = generation + 1
    try {
      const active = fresh(kind); token = active.token
      const output = await (kind === 'host' ? active.peer.offer() : active.peer.answer(code))
      if (disposed || token !== generation) return
      panel.showLobby(kind === 'host' ? '邀请已生成。请发送给朋友，并粘贴朋友返回的回应代码。' : '回应已生成。请发回房主，等待房主确认连接。', kind, false, output)
    } catch (error) { if (!disposed && token === generation) { peer?.close(); peer = undefined; role = null; panel.showLobby(error instanceof Error ? error.message : '连接失败，请重试', null) } }
  }
  const seat = () => role === 'host' ? 0 : 1
  const canBuild = () => Boolean(connected && world && state && state.mode !== 'fixed' && ['preparing', 'round-over', 'fighting'].includes(state.phase) && (state.phase === 'fighting' || !state.ready[seat()]))
  const action = (value: DuelAction) => {
    if (!canBuild()) return false
    if (role === 'host') { const result = match!.action(0, value); world = match!.world(); state = match!.state(); panel.refresh(); return result }
    return send({ type: 'action', sequence: ++actionSequence, round: state!.round, action: value })
  }
  const panelState = (): PanelState => {
    const actor = world!.actors.get(seat() + 1)!, progress = world!.participants![seat() + 1]!, settings = options.settings()
    return { shards: progress.shards, cards: listCardStates(world!, actor.id), player: { attrs: combatAttrs(actor), hp: actor.hp, shield: actor.shield, shieldCap: shieldCap(actor.attrs) },
      skillSlots: [...actor.skillSlots], knownSkills: SKILL_IDS.filter((id) => unlocked(actor.attrs, id)).map((id) => toSkillView(actor, id)), settings }
  }
  const build: PlanSession = {
    panelState, plan: () => structuredClone(state!.plans[seat()]), setPlan: (targets) => action({ kind: 'plan', targets: [...targets] }),
    setAutoBuy: (enabled) => { action({ kind: 'auto', enabled }) }, setQuickMode: (mode) => { action({ kind: 'quick-mode', mode }) },
    moveQueued: (index, direction) => { action({ kind: 'move', index, direction }) }, removeQueued: (index) => { action({ kind: 'remove', index }) },
    queueUpgrade: (id, level) => action({ kind: 'queue', id, level }),
  }
  const panel = createDuelPanel(options.root, {
    host: (mode) => { selectedMode = mode; void run('host') }, join: (code) => { void run('guest', code) },
    accept: async (code) => { try { await peer?.accept(code) } catch (error) { panel.showLobby(error instanceof Error ? error.message : '回应无效', role) } },
    ready: () => { if (role === 'host') match?.ready(0); else send({ type: 'ready' }) },
    forfeit: () => { if (role === 'host') match?.forfeit(0); else send({ type: 'forfeit' }) },
    shop: () => connected && state?.mode !== 'fixed' && world ? panelState() : undefined,
    buy: (id) => { action({ kind: 'buy', id }) }, sell: (id) => { action({ kind: 'sell', id }) }, equip: (slot, id) => { action({ kind: 'equip', slot, id }) }, queue: (id) => { action({ kind: 'queue', id }) },
    favorites: options.plans.favorites, favorite: options.plans.actions.favorite, plans: options.plans.actions, getPlans: options.plans.state,
    leave: () => { if (connected) send({ type: 'forfeit' }); options.leave() },
    retry: () => { generation++; peer?.close(); peer = undefined; connected = false; role = null; world = undefined; state = undefined; match = undefined; clearTimeout(connectionTimer); panel.showLobby('选择创建或加入新对局。', null) },
  })
  const loop = (now: number) => {
    if (disposed) return
    if (options.input.consumeMenuToggle()) panel.toggleMenu()
    options.input.consumeRestart()
    if (connected) {
      if (now - lastSeen > DUEL_RULES.disconnectMs) showFailure('对手长时间没有响应，连接已结束。请保持页面在前台并重新配对。')
      else {
        if (now - lastPing > 1000) { send({ type: 'ping', time: now }); lastPing = now }
        const elapsed = lastTime ? Math.min(0.25, Math.max(0, (now - lastTime) / 1000)) : 0
        if (role === 'host' && match) {
          accumulator += elapsed
          while (accumulator >= 1 / 60) {
            const active = match.state().phase === 'fighting', snap = toSnapshot(match.world(), 1)
            match.showOffers(0, !panel.menuOpen()); match.showOffers(1, remote.offersVisible(now))
            const own = active && !panel.menuOpen() ? cleanIntent(readDuelIntent(snap, options.input, options.pointer, options.touch, options.renderer, options.settings())) : IDLE_INPUT
            match.tick(own, remote.read(now)); accumulator -= 1 / 60
          }
          world = match.world(); state = match.state()
          if (now - lastSend >= 50) { send({ type: 'state', serial: ++serial, state, world: serializeWorld(world, true) }); lastSend = now }
        } else if (role === 'guest' && world && state && now - lastInputSend >= 1000 / 30) {
          const intent = state.phase === 'fighting' && !panel.menuOpen() ? cleanIntent(readDuelIntent(toSnapshot(world, 2), options.input, options.pointer, options.touch, options.renderer, options.settings())) : IDLE_INPUT
          send({ type: 'input', sequence: ++sequence, round: state.round, intent, offers: !panel.menuOpen() }); lastInputSend = now
        }
        if (world && state) {
          const seat = role === 'host' ? 0 : 1, signature = `${state.round}:${state.phase}`
          if (signature !== lastPhase) { resetInput(); remote.reset(); lastPhase = signature }
          const snapshot = toSnapshot(world, seat + 1)
          options.renderer.draw(snapshot, { fps: elapsed ? 1 / elapsed : 0, label: `1v1 · 第 ${Math.max(1, state.round)} 回合`, duel: true })
          options.touch.update(snapshot, state.phase !== 'fighting' || panel.menuOpen()); panel.showState(state, seat, ping); options.onSnapshot?.(snapshot, state.phase !== 'fighting')
        }
      }
    }
    lastTime = now; frame = requestAnimationFrame(loop)
  }
  resetInput(); options.touch.setPaused(true); frame = requestAnimationFrame(loop)
  return { toggleMenu: panel.toggleMenu, refresh: panel.refresh, build: () => canBuild() ? build : undefined, cards: () => canBuild() ? panelState().cards : [], buy: (id: string) => action({ kind: 'buy', id }), active: () => canBuild() && state?.phase === 'fighting' && !panel.menuOpen(), notice: () => state?.notices[seat()] ?? null, dispose: () => { if (disposed) return; disposed = true; generation++; clearTimeout(connectionTimer); cancelAnimationFrame(frame); peer?.close(); panel.dispose(); resetInput() } }
}
