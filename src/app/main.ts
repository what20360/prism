import './style.css'
import { CARD_REGISTRY } from '../content/cards'
import { buildDungeon, ROOMS_PER_FLOOR } from '../content/dungeon'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { createKeyboardInput } from '../input/keyboard'
import { createPointerInput } from '../input/pointer'
import { createCanvasRenderer } from '../render/canvas2d/renderer'
import { createSettingsStore } from '../storage/config'
import { createMenu, type Menu } from '../ui/menu'
import { createResultPanel, type ResultPanel } from '../ui/resultPanel'
import { createGame, type Game } from './game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')

const renderer = createCanvasRenderer(canvas)
const input = createKeyboardInput(window)
const pointer = createPointerInput(canvas)
const settingsStore = createSettingsStore()

const ui: { menu?: Menu; result?: ResultPanel } = {}

const game: Game = createGame({
  rooms: buildDungeon(),
  roomsPerFloor: ROOMS_PER_FLOOR,
  seed: 20261029,
  economy: DEFAULT_ECONOMY,
  registry: CARD_REGISTRY,
  playerAttrs: PLAYER_BASE_ATTRS,
  input,
  pointer,
  renderer,
  initialSettings: settingsStore.load(),
  onSettingsChange: settingsStore.save,
  onUiModeChange: (mode) => {
    if (mode === 'menu') {
      ui.menu?.open()
      return
    }
    ui.menu?.close()
    ui.result?.hide()
  },
  onRunEnd: (summary) => {
    ui.menu?.close()
    ui.result?.show(summary)
  },
})

ui.menu = createMenu(document.body, {
  onClose: () => game.setUiMode('play'),
  onRestart: () => game.restart(),
  onBuy: (cardId) => {
    game.buyCard(cardId)
    ui.menu?.refresh()
  },
  onSetting: (key, value) => {
    game.setSetting(key, value)
    ui.menu?.refresh()
  },
  getState: () => game.panelState(),
})

ui.result = createResultPanel(document.body, {
  onRestart: () => game.restart(),
})

game.start()

if (import.meta.env.DEV) {
  const hooks = window as Window & { __prism?: Game; __ui?: typeof ui }
  hooks.__prism = game
  hooks.__ui = ui
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose()
    input.dispose()
    pointer.dispose()
    renderer.dispose()
  })
}
