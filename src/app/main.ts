import './style.css'
import { CARD_REGISTRY } from '../content/cards'
import { buildDungeon, ROOMS_PER_FLOOR } from '../content/dungeon'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { createKeyboardInput } from '../input/keyboard'
import { createPointerInput } from '../input/pointer'
import { createTouchControls } from '../input/touch'
import { createAudioEngine } from '../audio/audio'
import { createCanvasRenderer } from '../render/canvas2d/renderer'
import { createSettingsStore, type SettingKey, type ControlSettings } from '../storage/config'
import { createHomeMenu } from '../ui/homeMenu'
import { createMenu, type Menu } from '../ui/menu'
import { createResultPanel, type ResultPanel } from '../ui/resultPanel'
import { createPracticeMode } from './modes/practice'
import { createEndlessMode } from './modes/endless'
import { createGame, type Game, type UiMode } from './game'
import type { RunCheckpoint } from './checkpoints'
import { createSaveManager } from './saveManager'
import { createDuelSession } from './duelSession'
import { createPlanManager } from './planManager'
import { createQuickBuy } from '../ui/quickBuy'
import type { DungeonDifficulty } from '../content/difficulties'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')
const renderer = createCanvasRenderer(canvas), input = createKeyboardInput(window), pointer = createPointerInput(canvas)
const settingsStore = createSettingsStore(), audio = createAudioEngine()
let preferences = settingsStore.load(), game: Game | undefined, sessionCounter = 0
const ui: { menu?: Menu; result?: ResultPanel } = {}
let duel: ReturnType<typeof createDuelSession> | undefined
const touch = createTouchControls(document.body, () => duel ? duel.toggleMenu() : game?.setUiMode('menu'))
const testButton = document.createElement('button'); testButton.className = 'practice-shortcut'; testButton.textContent = '测试控制'; testButton.hidden = true
const openTest = () => { if (game?.session().practice) { game.setUiMode('menu'); ui.menu?.open('practice') } }
testButton.onclick = openTest; document.body.append(testButton)
const unlockAudio = () => audio.unlock()
document.addEventListener('pointerdown', unlockAudio); document.addEventListener('keydown', unlockAudio)
audio.configure(preferences); touch.setVisible(preferences.touchControls === true)
const saveSettings = (settings: ControlSettings) => { preferences = settings; settingsStore.save(settings); audio.configure(settings); touch.setVisible(settings.touchControls === true); home?.refresh() }
const onSetting = <K extends SettingKey>(key: K, value: ControlSettings[K]) => { if (game) game.setSetting(key, value); else saveSettings({ ...preferences, [key]: value }) }
const returnHome = () => game?.setUiMode('home')
const showMode = (mode: UiMode) => {
  if (mode !== 'play') saves.autoSave()
  document.body.classList.toggle('is-home', mode === 'home')
  ui.result?.hide(); testButton.hidden = mode !== 'play' || !game?.session().practice
  if (mode === 'home') { ui.menu?.close(); home.show() }
  else if (mode === 'menu') { home.hide(); ui.menu?.open() }
  else { home.hide(); ui.menu?.close() }
}
const launch = (kind: 'dungeon' | 'practice' | 'endless', initialUiMode: UiMode = 'play', seed?: number, checkpoint?: RunCheckpoint, difficulty: DungeonDifficulty = 1) => {
  saves.autoSave()
  game?.dispose(); input.reset(); pointer.reset(); touch.reset(); ui.result?.hide(); ui.menu?.close(); home.hide()
  const mode = kind === 'practice' ? createPracticeMode() : undefined, endless = kind === 'endless' ? createEndlessMode() : undefined
  const worldSeed = seed ?? (kind === 'dungeon' ? crypto.getRandomValues(new Uint32Array(1))[0]! : 20261029 + ++sessionCounter * 997)
  const selectedDifficulty = kind !== 'dungeon' ? undefined : checkpoint ? checkpoint.difficulty : difficulty
  game = createGame({ rooms: mode ? [mode.room()] : endless ? [endless.room()] : selectedDifficulty ? buildDungeon({ seed: worldSeed, difficulty: selectedDifficulty }) : buildDungeon(), roomsPerFloor: ROOMS_PER_FLOOR, seed: worldSeed, difficulty: selectedDifficulty,
    economy: DEFAULT_ECONOMY, registry: CARD_REGISTRY, playerAttrs: PLAYER_BASE_ATTRS, input, pointer, touch, renderer,
    initialSettings: preferences, initialUiMode, practice: mode, endless, checkpoint, onSettingsChange: saveSettings,
    onSnapshot: (snapshot, paused) => { touch.update(snapshot, paused); audio.update(snapshot, paused) },
    onUiModeChange: showMode,
    onRunEnd: (summary) => { ui.menu?.close(); testButton.hidden = true; ui.result?.show(summary) },
  })
  if (!checkpoint?.plan?.quickMode) game.setQuickMode(plans.quickMode())
  game.start()
  saves.autoSave()
}
const saves = createSaveManager({ capture: () => game?.checkpoint() ?? null, setCurrentName: (name) => game?.setSaveName(name), load: (saved) => launch(saved.mode, 'menu', saved.initialSeed, saved), refresh: () => { home?.refresh(); ui.menu?.refresh() } })
const plans = createPlanManager({ game: () => duel ? duel.build() : game?.session().canResume ? game : undefined, refresh: () => { home?.refresh(); ui.menu?.refresh(); duel?.refresh(); quickBuy?.refresh() }, saved: () => { if (!duel) saves.autoSave() } })
const quickBuy = createQuickBuy(document.body, {
  active: () => duel ? duel.active() : Boolean(game?.session().canResume) && game?.debug().uiMode === 'play', mode: plans.quickMode, favorites: plans.favorites,
  notice: () => duel ? duel.notice() : game?.purchaseNotice() ?? null,
  cards: () => duel ? duel.cards() : game?.panelState().cards ?? [], buy: (id) => { if (duel ? duel.buy(id) : game?.buyCard(id)) { audio.notify('buy'); if (!duel) saves.autoSave() } },
})
const openDuel = () => {
  saves.autoSave(); game?.setUiMode('home'); game?.stop(); home.hide(); ui.menu?.close(); ui.result?.hide(); testButton.hidden = true
  document.body.classList.remove('is-home'); document.body.classList.add('is-duel')
  duel = createDuelSession({ root: document.body, input, pointer, touch, renderer, plans, settings: () => preferences, onSnapshot: (snapshot, paused) => audio.update(snapshot, paused), leave: () => {
    duel?.dispose(); duel = undefined; document.body.classList.remove('is-duel'); game?.setUiMode('home'); game?.start()
  } })
}
const home = createHomeMenu(document.body, {
  saves: saves.handlers, getSaves: saves.state, onDuel: openDuel,
  plans: plans.actions, getPlans: plans.state,
  getState: () => {
    const session = game?.session(), attrs = session?.canResume ? game!.panelState().player.attrs : PLAYER_BASE_ATTRS
    return { canResume: session?.canResume ?? false, practice: session?.practice ?? false, endless: session?.endless ?? false, attrs,
      settings: { ...preferences, aimMode: attrs.autoAim > 0 ? preferences.aimMode : 'manual', fireMode: attrs.autoFire > 0 ? preferences.fireMode : 'manual' } }
  },
  onDungeon: (seed, difficulty) => launch('dungeon', 'play', seed, undefined, difficulty), onPractice: () => launch('practice'), onEndless: (seed) => launch('endless', 'play', seed), onResume: () => { if (game?.session().canResume) game.setUiMode('play') }, onSetting,
})
ui.menu = createMenu(document.body, {
  favorites: plans.favorites, onFavorite: plans.actions.favorite,
  saves: saves.handlers, getSaves: saves.state,
  plans: plans.actions, getPlans: plans.state, onQueue: (id) => { game?.queueUpgrade(id); saves.autoSave(); ui.menu?.open('plans') },
  onClose: () => game?.setUiMode('play'), onRestart: () => game?.restart(), onHome: returnHome,
  onBuy: (id) => { if (game?.buyCard(id)) audio.notify('buy'); saves.autoSave(); ui.menu?.refresh() },
  onSell: (id) => { if (game?.sellCard(id)) audio.notify('sell'); saves.autoSave(); ui.menu?.refresh() },
  onEquip: (slot, id) => { game?.equipSkill(slot, id); saves.autoSave(); ui.menu?.refresh() },
  onPractice: (action) => { game?.practiceAction(action); ui.menu?.refresh() },
  onSetting, getState: () => game!.panelState(),
})
ui.result = createResultPanel(document.body, { onRestart: () => game?.restart(), onHome: returnHome })
launch('dungeon', 'home')
const saveTimer = window.setInterval(saves.autoSave, 10000)
const saveOnHide = () => { if (document.hidden) saves.autoSave() }
window.addEventListener('pagehide', saves.autoSave); document.addEventListener('visibilitychange', saveOnHide)
if (import.meta.env.DEV) {
  const hooks = window as Window & { __prism?: Game }
  Object.defineProperty(hooks, '__prism', { get: () => game, configurable: true })
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  duel?.dispose()
  quickBuy.dispose()
  clearInterval(saveTimer); window.removeEventListener('pagehide', saves.autoSave); document.removeEventListener('visibilitychange', saveOnHide)
  game?.dispose(); input.dispose(); pointer.dispose(); renderer.dispose(); touch.dispose(); audio.dispose(); home.dispose(); testButton.remove()
  document.removeEventListener('pointerdown', unlockAudio); document.removeEventListener('keydown', unlockAudio)
})
