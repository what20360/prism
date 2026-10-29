import './style.css'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { TRAINING_ROOM } from '../content/rooms'
import { createKeyboardInput } from '../input/keyboard'
import { createCanvasRenderer } from '../render/canvas2d/renderer'
import { createGame } from './game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('missing #game canvas')

const renderer = createCanvasRenderer(canvas)
const input = createKeyboardInput(window)

const game = createGame({
  seed: 20261029,
  room: TRAINING_ROOM,
  economy: DEFAULT_ECONOMY,
  playerAttrs: PLAYER_BASE_ATTRS,
  playerSpawn: { x: 960, y: 540 },
  input,
  renderer,
})

game.start()

if (import.meta.env.DEV) {
  ;(window as Window & { __prism?: typeof game }).__prism = game
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose()
    input.dispose()
    renderer.dispose()
  })
}