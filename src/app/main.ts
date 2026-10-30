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
import { createHomeMenu, type HomeMenu } from '../ui/homeMenu'
import { createMenu, type Menu } from '../ui/menu'
import { createResultPanel, type ResultPanel } from '../ui/resultPanel'
import { createPracticeMode } from './modes/practice'
import { createGame, type Game, type UiMode } from './game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')
const renderer = createCanvasRenderer(canvas), input = createKeyboardInput(window), pointer = createPointerInput(canvas)
const settingsStore = createSettingsStore(), audio = createAudioEngine()
let preferences = settingsStore.load(), game: Game | undefined, home: HomeMenu, sessionCounter = 0
const ui: { menu?: Menu; result?: ResultPanel } = {}
const touch = createTouchControls(document.body, () => game?.setUiMode('menu'))
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
  document.body.classList.toggle('is-home', mode === 'home')
  ui.result?.hide(); testButton.hidden = mode !== 'play' || !game?.session().practice
  if (mode === 'home') { ui.menu?.close(); home.show() }
  else if (mode === 'menu') { home.hide(); ui.menu?.open() }
  else { home.hide(); ui.menu?.close() }
}
const launch = (practice: boolean, initialUiMode: UiMode = 'play') => {
  game?.dispose(); input.reset(); pointer.reset(); touch.reset(); ui.result?.hide(); ui.menu?.close(); home.hide()
  const mode = practice ? createPracticeMode() : undefined
  game = createGame({ rooms: mode ? [mode.room()] : buildDungeon(), roomsPerFloor: ROOMS_PER_FLOOR, seed: 20261029 + ++sessionCounter * 997,
    economy: DEFAULT_ECONOMY, registry: CARD_REGISTRY, playerAttrs: PLAYER_BASE_ATTRS, input, pointer, touch, renderer,
    initialSettings: preferences, initialUiMode, practice: mode, onSettingsChange: saveSettings,
    onSnapshot: (snapshot, paused) => { touch.update(snapshot, paused); audio.update(snapshot, paused) },
    onUiModeChange: showMode,
    onRunEnd: (summary) => { ui.menu?.close(); testButton.hidden = true; ui.result?.show(summary) },
  })
  game.start()
}
home = createHomeMenu(document.body, {
  getState: () => {
    const session = game?.session(), attrs = session?.canResume ? game!.panelState().player.attrs : PLAYER_BASE_ATTRS
    return { canResume: session?.canResume ?? false, practice: session?.practice ?? false, attrs,
      settings: { ...preferences, aimMode: attrs.autoAim > 0 ? preferences.aimMode : 'manual', fireMode: attrs.autoFire > 0 ? preferences.fireMode : 'manual' } }
  },
  onDungeon: () => launch(false), onPractice: () => launch(true), onResume: () => { if (game?.session().canResume) game.setUiMode('play') }, onSetting,
})
ui.menu = createMenu(document.body, {
  onClose: () => game?.setUiMode('play'), onRestart: () => game?.restart(), onHome: returnHome,
  onBuy: (id) => { if (game?.buyCard(id)) audio.notify('buy'); ui.menu?.refresh() },
  onSell: (id) => { if (game?.sellCard(id)) audio.notify('sell'); ui.menu?.refresh() },
  onEquip: (slot, id) => { game?.equipSkill(slot, id); ui.menu?.refresh() },
  onPractice: (action) => { game?.practiceAction(action); ui.menu?.refresh() },
  onSetting, getState: () => game!.panelState(),
})
ui.result = createResultPanel(document.body, { onRestart: () => game?.restart(), onHome: returnHome })
launch(false, 'home')
if (import.meta.env.DEV) {
  const hooks = window as Window & { __prism?: Game }
  Object.defineProperty(hooks, '__prism', { get: () => game, configurable: true })
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  game?.dispose(); input.dispose(); pointer.dispose(); renderer.dispose(); touch.dispose(); audio.dispose(); home.dispose(); testButton.remove()
  document.removeEventListener('pointerdown', unlockAudio); document.removeEventListener('keydown', unlockAudio)
})
