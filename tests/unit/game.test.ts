import { createPointerInput } from '../../src/input/pointer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGame, type GameOptions } from '../../src/app/game'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import type { RoomSpec } from '../../src/core/dungeon'

describe('game lifecycle', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrameId: number

  beforeEach(() => {
    frames = new Map()
    nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })

  afterEach(() => vi.unstubAllGlobals())

  function advance(now: number): void {
    const pending = frames.entries().next().value
    if (!pending) throw new Error('animation loop stopped')
    const [id, callback] = pending
    frames.delete(id)
    callback(now)
  }

  function idleGame(overrides: Partial<GameOptions> = {}) {
    const input = {
      read: vi.fn(() => ({ move: { x: 0, y: 0 } })),
      consumeMenuToggle: () => false,
      consumeRestart: () => false,
      reset: vi.fn(),
      dispose: () => {},
    }
    const pointer = {
      position: () => ({ x: 800, y: 500 }),
      firing: () => false,
      reset: vi.fn(),
      dispose: () => {},
    }
    const game = createGame({
      rooms: [{
        id: 'safe', kind: 'safe',
        bounds: { x: 0, y: 0, width: 3200, height: 1800 },
        walls: [], entry: { x: 500, y: 500 }, spawns: [],
      }],
      roomsPerFloor: 1,
      seed: 7,
      economy: DEFAULT_ECONOMY,
      registry: CARD_REGISTRY,
      playerAttrs: PLAYER_BASE_ATTRS,
      input,
      pointer,
      renderer: { draw: vi.fn(), viewToWorld: (x, y) => ({ x, y }), dispose: () => {} },
      ...overrides,
    })
    return { game, input, pointer }
  }

  it('does not grant automatic fire through saved preferences without a card', () => {
    const { game } = idleGame({ initialSettings: { aimMode: 'auto', fireMode: 'auto' } })
    game.start(); advance(1000); advance(1200)
    expect(game.debug().projectiles).toBe(0)
    game.dispose()
  })

  it('combines touch movement, aim, shooting and mine input in the same tick', () => {
    const { game } = idleGame({ touch: {
      read: () => ({ move: { x: 1, y: 0 }, aim: { x: 0, y: -1 }, fire: true, placeMine: true }),
      reset: () => {}, setPaused: () => {}, setVisible: () => {}, update: () => {}, dispose: () => {},
    } })
    game.start(); advance(1000); advance(1200)
    expect(game.debug().playerX).toBeGreaterThan(500)
    expect(game.debug().projectiles).toBeGreaterThan(0)
    expect(game.debug().mines).toBe(1)
    game.dispose()
  })

  it('right-click selects or clears a manual target while left shooting preserves the selection', () => {
    const surface = new EventTarget(), windowEvents = new EventTarget()
    vi.stubGlobal('window', windowEvents)
    const pointer = createPointerInput(surface as HTMLElement)
    let manual = false
    const { game } = idleGame({ pointer,
      rooms: [{ id: 'lock-test', kind: 'combat', bounds: { x: 0, y: 0, width: 3200, height: 1800 }, walls: [], entry: { x: 500, y: 500 },
        spawns: [{ name: 'Target', pos: { x: 800, y: 500 }, attrs: { ...PLAYER_BASE_ATTRS, maxHp: 10000, speed: 0, fireRate: 0 }, tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: false }] }],
      onSnapshot: (snapshot) => { manual = snapshot.actors.some((actor) => actor.team === 'enemy' && actor.manualLocked) },
    })
    const click = (button: number, x: number, y: number) => surface.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button, pointerType: 'mouse', clientX: x, clientY: y }))
    game.start(); advance(1000)
    click(2, 800, 500); advance(1100)
    expect(manual).toBe(true); expect(game.debug().projectiles).toBe(0)
    click(0, 600, 600); advance(1200)
    expect(manual).toBe(true); expect(game.debug().projectiles).toBeGreaterThan(0)
    click(2, 600, 600); advance(1300)
    expect(manual).toBe(false); expect(pointer.firing()).toBe(true)
    game.dispose(); pointer.dispose()
  })

  it('keeps manual aim stable with a stationary pointer across variable-frame catch-up ticks', () => {
    const angles: number[] = []
    let lastDrawn = { x: 500, y: 500 }
    const { game } = idleGame({
      input: { read: () => ({ move: { x: 1, y: 0 } }), consumeMenuToggle: () => false, consumeRestart: () => false, reset: () => {}, dispose: () => {} },
      renderer: {
        draw: (snapshot) => { const p = snapshot.actors.find((a) => a.team === 'player')!; lastDrawn = { x: p.x, y: p.y }; if (snapshot.tick > 0) angles.push(p.aimAngle) },
        viewToWorld: (_x, _y, focus) => ({ x: (focus ?? lastDrawn).x + 300, y: (focus ?? lastDrawn).y - 200 }),
        dispose: () => {},
      },
    })
    game.start()
    for (const now of [1000, 1018, 1033, 1067, 1084, 1134, 1150, 1185]) advance(now)
    expect(angles.length).toBeGreaterThan(4)
    for (const angle of angles) expect(angle).toBeCloseTo(Math.atan2(-200, 300), 12)
    game.dispose()
  })

  it('keeps the animation loop alive after a lethal hit with manual aim', () => {
    const room: RoomSpec = {
      id: 'lethal-contact',
      kind: 'combat',
      bounds: { x: 0, y: 0, width: 3200, height: 1800 },
      walls: [],
      entry: { x: 500, y: 500 },
      spawns: [{
        pos: { x: 500, y: 500 },
        attrs: { ...PLAYER_BASE_ATTRS, maxHp: 1000, speed: 0, fireRate: 0 },
        tier: 'normal',
        behavior: 'chase',
        contactDamage: 1000,
        hasCore: false,
      }],
    }
    const onRunEnd = vi.fn()
    let wantsRestart = false
    const game = createGame({
      rooms: [room],
      roomsPerFloor: 1,
      seed: 7,
      economy: DEFAULT_ECONOMY,
      registry: CARD_REGISTRY,
      playerAttrs: PLAYER_BASE_ATTRS,
      input: {
        read: () => ({ move: { x: 0, y: 0 } }),
        consumeMenuToggle: () => false,
        consumeRestart: () => {
          const requested = wantsRestart
          wantsRestart = false
          return requested
        },
        reset: () => { wantsRestart = false },
        dispose: () => {},
      },
      pointer: {
        position: () => ({ x: 800, y: 500 }),
        firing: () => false,
        reset: () => {},
        dispose: () => {},
      },
      renderer: {
        draw: vi.fn(),
        viewToWorld: (x, y) => ({ x, y }),
        dispose: () => {},
      },
      onRunEnd,
    })
    game.setSetting('aimMode', 'manual')
    game.start()
    advance(1000)

    // More than one tick is due: the first kills the player, subsequent ticks
    // must not ask manual aiming for a living player that no longer exists.
    expect(() => advance(1100)).not.toThrow()
    expect(onRunEnd).toHaveBeenCalledOnce()
    expect(game.debug().gameOver).toBe(true)
    expect(() => advance(1200)).not.toThrow()

    wantsRestart = true
    advance(1300)
    expect(game.debug()).toMatchObject({ gameOver: false, paused: false, tick: 0 })
    game.dispose()
  })

  it('does not poll combat input while paused or replay paused time on resume', () => {
    const { game, input } = idleGame()
    game.start()
    advance(1000)
    advance(1050)
    game.setUiMode('menu')
    const tick = game.debug().tick
    const reads = input.read.mock.calls.length
    advance(5000)
    advance(6000)
    expect(game.debug().tick).toBe(tick)
    expect(input.read).toHaveBeenCalledTimes(reads)
    game.setUiMode('play')
    advance(6020)
    expect(game.debug().tick - tick).toBeLessThanOrEqual(2)
    game.dispose()
  })

  it('starts a fresh run from the menu, releasing inputs and resetting the frame clock', () => {
    const onUiModeChange = vi.fn()
    const { game, input, pointer } = idleGame({ onUiModeChange })
    game.start()
    advance(1000)
    advance(1200)
    game.setUiMode('menu')
    game.restart()
    expect(input.reset).toHaveBeenCalledOnce()
    expect(pointer.reset).toHaveBeenCalledOnce()
    expect(onUiModeChange).toHaveBeenLastCalledWith('play')
    advance(10000)
    expect(game.debug()).toMatchObject({ tick: 0, roomIndex: 0, uiMode: 'play', paused: false })
    game.dispose()
  })

  it('discards paused time even if no animation frames ran while the menu was open', () => {
    const { game } = idleGame()
    game.start()
    advance(1000)
    advance(1050)
    const tick = game.debug().tick
    game.setUiMode('menu')
    game.setUiMode('play')
    advance(10000)
    expect(game.debug().tick).toBe(tick)
    game.dispose()
  })

  it('restores preferences on startup, reports changes and retains them across restarts', () => {
    const onSettingsChange = vi.fn()
    const { game } = idleGame({
      initialSettings: { aimMode: 'manual', fireMode: 'manual', music: false },
      onSettingsChange,
    })
    expect(game.panelState().settings).toMatchObject({ aimMode: 'manual', fireMode: 'manual', music: false })
    game.setSetting('music', true)
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ music: true }))
    game.setSetting('music', true)
    expect(onSettingsChange).toHaveBeenCalledOnce()
    game.restart()
    expect(game.panelState().settings).toMatchObject({ aimMode: 'manual', fireMode: 'manual' })
    game.dispose()
  })
})
