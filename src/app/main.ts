import './style.css'
import { CARD_REGISTRY } from '../content/cards'
import { buildDungeon, ROOMS_PER_FLOOR } from '../content/dungeon'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { createKeyboardInput } from '../input/keyboard'
import { createCanvasRenderer } from '../render/canvas2d/renderer'
import { createHelpPanel, type HelpPanel } from '../ui/helpPanel'
import { createResultPanel, type ResultPanel } from '../ui/resultPanel'
import { createUpgradePanel, type UpgradePanel } from '../ui/upgradePanel'
import { createGame, type Game } from './game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')

const renderer = createCanvasRenderer(canvas)
const input = createKeyboardInput(window)

const ui: { panel?: UpgradePanel; result?: ResultPanel; help?: HelpPanel } = {}

const game: Game = createGame({
  rooms: buildDungeon(),
  roomsPerFloor: ROOMS_PER_FLOOR,
  seed: 20261029,
  economy: DEFAULT_ECONOMY,
  registry: CARD_REGISTRY,
  playerAttrs: PLAYER_BASE_ATTRS,
  input,
  renderer,
  onUiModeChange: (mode) => {
    if (mode === 'upgrade') {
      ui.help?.hide()
      ui.panel?.show(game.panelState())
      return
    }
    if (mode === 'help') {
      ui.panel?.hide()
      ui.help?.show()
      return
    }
    ui.panel?.hide()
    ui.help?.hide()
  },
  onRunEnd: (summary) => {
    ui.panel?.hide()
    ui.help?.hide()
    ui.result?.show(summary)
  },
})

ui.panel = createUpgradePanel(document.body, {
  onBuy: (cardId) => {
    game.buyCard(cardId)
    ui.panel?.render(game.panelState())
  },
  onClose: () => game.setUiMode('play'),
})

ui.help = createHelpPanel(document.body)

ui.result = createResultPanel(document.body, {
  onRestart: () => {
    ui.result?.hide()
    game.restart()
  },
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
    renderer.dispose()
  })
}