import './style.css'
import { CARD_REGISTRY } from '../content/cards'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { TRAINING_ROOM } from '../content/rooms'
import { createKeyboardInput } from '../input/keyboard'
import { createCanvasRenderer } from '../render/canvas2d/renderer'
import { createUpgradePanel } from '../ui/upgradePanel'
import { createGame, type Game } from './game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')

const renderer = createCanvasRenderer(canvas)
const input = createKeyboardInput(window)

const game: Game = createGame({
  seed: 20261029,
  room: TRAINING_ROOM,
  economy: DEFAULT_ECONOMY,
  registry: CARD_REGISTRY,
  playerAttrs: PLAYER_BASE_ATTRS,
  playerSpawn: { x: 960, y: 540 },
  input,
  renderer,
  onPauseChange: (paused) => {
    if (paused) panel.show(game.panelState())
    else panel.hide()
  },
})

const panel = createUpgradePanel(document.body, {
  onBuy: (cardId) => {
    game.buyCard(cardId)
    panel.render(game.panelState())
  },
  onClose: () => game.setPaused(false),
})

game.start()

if (import.meta.env.DEV) {
  const hooks = window as Window & { __prism?: Game; __panel?: typeof panel }
  hooks.__prism = game
  hooks.__panel = panel
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose()
    input.dispose()
    renderer.dispose()
  })
}