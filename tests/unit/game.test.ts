import { createPointerInput } from '../../src/input/pointer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGame, type GameOptions } from '../../src/app/game'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { createPracticeMode, DEFAULT_PRACTICE } from '../../src/app/modes/practice'
import { createEndlessMode } from '../../src/app/modes/endless'
import type { RoomSpec } from '../../src/core/dungeon'
import { readCheckpoint } from '../../src/app/checkpoints'
import type { Snapshot } from '../../src/core/snapshot'

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
        walls: [], entry: { x: 500, y: 500 }, spawns: [], pickups: [{ kind: 'shard', pos: { x: 500, y: 500 }, value: 15 }],
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

  it('opens on the home screen without advancing or accepting an Escape resume', () => {
    const read = vi.fn(() => ({ move: { x: 1, y: 0 } }))
    const { game } = idleGame({ initialUiMode: 'home', input: {
      read, consumeRestart: () => false, consumeMenuToggle: () => true, reset: () => {}, dispose: () => {},
    } })
    game.start(); advance(1000); advance(4000)
    expect(game.debug()).toMatchObject({ tick: 0, uiMode: 'home', paused: true })
    expect(game.session().canResume).toBe(false); expect(read).not.toHaveBeenCalled()
    game.setUiMode('play'); expect(game.session().canResume).toBe(true)
    game.dispose()
  })

  it('freezes and resumes the same run from home without losing purchases or catching up', () => {
    const { game } = idleGame(); game.start(); advance(1000); advance(1200)
    expect(game.buyCard('gun-damage')).toBe(true)
    game.setUiMode('home'); const tick = game.debug().tick
    advance(10000); expect(game.debug().tick).toBe(tick); expect(game.session().canResume).toBe(true)
    game.setUiMode('play'); advance(11000)
    expect(game.debug().tick).toBe(tick); expect(game.debug().purchases).toBe(1)
    game.dispose()
  })

  it('rejects test controls in normal dungeon sessions', () => {
    const { game } = idleGame(); game.setUiMode('menu')
    expect(game.practiceAction({ type: 'card-level', id: 'gun-damage', level: 10 })).toBe(false)
    expect(game.panelState().practice).toBeUndefined(); expect(game.panelState().player.attrs.damage).toBe(10)
    game.dispose()
  })
  it('only spends on a preorder while playing and waits for funds', () => {
    const { game } = idleGame(); game.start(); advance(1000); advance(1200); game.setUiMode('menu')
    expect(game.queueUpgrade('gun-damage')).toBe(true); expect(game.queueUpgrade('gun-range', 2)).toBe(true)
    advance(1400); expect(game.panelState().player.attrs.damage).toBe(10)
    game.setUiMode('play'); advance(1500); advance(1700)
    expect(game.purchaseNotice()?.id).toBe('gun-damage'); expect(game.panelState().player.attrs.damage).toBe(10)
    for (let now = 1900; now <= 4900; now += 200) advance(now)
    expect(game.panelState().player.attrs.damage).toBe(12); expect(game.debug().shards).toBe(5)
    expect(game.plan().targets).toEqual([{ id: 'gun-range', level: 2 }]); game.dispose()
  })
  it('does not bypass prerequisites and can reorder blocked preorders', () => {
    const { game } = idleGame({ rooms: [{ id: 'funded', kind: 'safe', bounds: { x: 0, y: 0, width: 3200, height: 1800 }, walls: [], entry: { x: 500, y: 500 }, spawns: [], pickups: [{ kind: 'shard', pos: { x: 500, y: 500 }, value: 100 }] }] })
    game.queueUpgrade('ricochet'); game.queueUpgrade('gun-pierce'); game.start(); advance(1000); advance(1200)
    expect(game.debug().purchases).toBe(0); expect(game.debug().shards).toBe(100)
    game.moveQueued(1, -1); advance(1400)
    for (let now = 1600; now <= 8000; now += 200) advance(now)
    expect(game.panelState().player.attrs.ricochet).toBe(1); expect(game.debug().shards).toBe(54); expect(game.plan().targets).toHaveLength(0)
    expect(game.setPlan([{ id: 'unknown', level: 1 }])).toBe(false); expect(game.queueUpgrade('ricochet', 2)).toBe(false)
    game.dispose()
  })
  it('grants the dungeon starting budget once and retains difficulty and seed on restart', () => {
    const { game } = idleGame({ difficulty: 7, seed: 8765 })
    expect(game.debug().shards).toBe(200); game.buyCard('gun-damage'); expect(game.debug().shards).toBe(190)
    const saved = readCheckpoint(JSON.stringify(game.checkpoint())); game.dispose()
    const loaded = idleGame({ checkpoint: saved, difficulty: saved.difficulty, seed: saved.initialSeed }).game
    expect(loaded.debug().shards).toBe(190); expect(loaded.panelState().dungeon?.difficulty).toBe(7)
    loaded.restart(); expect(loaded.debug().shards).toBe(200)
    expect(readCheckpoint(JSON.stringify(loaded.checkpoint())).world.seed).toBe(8765); loaded.dispose()
  })
  it('restores a live run and its paused purchase plan without catching up or regenerating resources', () => {
    const { game } = idleGame(); game.start(); advance(1000); advance(1200); game.buyCard('gun-damage'); game.queueUpgrade('gun-range', 2); game.setAutoBuy(false)
    const checkpoint = readCheckpoint(JSON.stringify(game.checkpoint())), tick = game.debug().tick
    game.dispose(); const loaded = idleGame({ seed: checkpoint.initialSeed, checkpoint, initialUiMode: 'menu' }).game
    loaded.start(); advance(20000)
    expect(loaded.debug().tick).toBe(tick); expect(loaded.panelState().player.attrs.damage).toBe(12)
    expect(loaded.plan()).toEqual({ enabled: false, targets: [{ id: 'gun-range', level: 2 }] })
    expect(loaded.checkpoint()?.world.pickups).toEqual(checkpoint.world.pickups)
    loaded.setUiMode('play'); advance(30000); expect(loaded.debug().tick).toBe(tick); loaded.dispose()
  })
  it('boots and restarts endless mode with the same seed, first floor and no test privileges', () => {
    const { game } = idleGame({ endless: createEndlessMode(), seed: 4321 })
    const state = game.panelState().endless
    expect(state).toMatchObject({ seed: 4321, floor: 1, open: false, alive: 0, pending: 6 })
    expect(game.session().endless).toBe(true); expect(game.session().practice).toBe(false)
    game.setUiMode('menu'); expect(game.practiceAction({ type: 'card-level', id: 'gun-damage', level: 10 })).toBe(false)
    game.restart()
    expect(game.panelState().endless).toEqual(state); expect(game.debug().purchases).toBe(0)
    game.dispose()
  })

  it('restarts a practice session with its configuration and clears the build', () => {
    const mode = createPracticeMode()
    const { game } = idleGame({ practice: mode })
    game.setUiMode('menu')
    expect(game.practiceAction({ type: 'configure', config: { ...DEFAULT_PRACTICE, scenario: 'combat', count: 5, invincible: false, freeCards: false } })).toBe(true)
    expect(game.practiceAction({ type: 'card-level', id: 'gun-damage', level: 10 })).toBe(true)
    expect(game.panelState().player.attrs.damage).toBe(30)
    game.restart()
    expect(game.session().practice).toBe(true)
    expect(game.panelState().practice?.config).toMatchObject({ scenario: 'combat', count: 5, invincible: false, freeCards: false })
    expect(game.debug()).toMatchObject({ tick: 0, purchases: 0, enemies: 5, shards: 1000, uiMode: 'play', paused: false })
    expect(game.panelState().player.attrs.damage).toBe(10)
    expect(game.practiceAction({ type: 'meters-reset' })).toBe(false)
    game.dispose()
  })

  it('provides free purchases even when a high-level price exceeds the normal test credit', () => {
    const { game } = idleGame({ practice: createPracticeMode() })
    game.setUiMode('menu')
    expect(game.practiceAction({ type: 'card-level', id: 'gun-damage', level: 60 })).toBe(true)
    expect(game.panelState().cards.find((card) => card.id === 'gun-damage')?.availability).toBe('ok')
    expect(game.buyCard('gun-damage')).toBe(true)
    expect(game.panelState().player.attrs.damage).toBe(132)
    expect(Number.isFinite(game.debug().shards)).toBe(true)
    game.dispose()
  })

  it('does not grant automatic fire through saved preferences without a card', () => {
    const { game } = idleGame({ initialSettings: { aimMode: 'auto', fireMode: 'auto' } })
    game.start(); advance(1000); advance(1200)
    expect(game.debug().projectiles).toBe(0)
    game.dispose()
  })

  it('applies desktop automatic aim and fire switches immediately without reopening a page', () => {
    let snapshot: Snapshot | undefined
    const { game } = idleGame({ practice: createPracticeMode(), pointer: { position: () => ({ x: -5000, y: 5000 }), firing: () => false, reset() {}, dispose() {} },
      renderer: { draw: (s) => { snapshot = s }, viewToWorld: (x, y) => ({ x, y }), dispose() {} } })
    game.setUiMode('menu')
    for (const id of ['auto-aim', 'auto-fire']) expect(game.practiceAction({ type: 'card-level', id, level: 1 })).toBe(true)
    game.setUiMode('play'); game.start(); advance(1000); advance(1200)
    expect(snapshot!.actors.find((a) => a.id === 1)!.aimAngle).toBeLessThan(0)
    expect(snapshot!.projectiles[0]!.vy).toBeLessThan(0)
    game.setSetting('aimMode', 'manual'); game.setSetting('fireMode', 'manual'); advance(1400)
    expect(game.panelState().settings).toMatchObject({ aimMode: 'manual', fireMode: 'manual' })
    expect(snapshot!.actors.find((a) => a.id === 1)!.aimAngle).toBeGreaterThan(Math.PI / 2)
    game.dispose()
  })

  it('preserves a disabled magnet preference across purchases, practice grants and restarts', () => {
    const { game } = idleGame({ practice: createPracticeMode(), initialSettings: { aimMode: 'manual', fireMode: 'manual', autoPickup: false } })
    game.setUiMode('menu')
    expect(game.buyCard('magnet')).toBe(true)
    expect(game.panelState().player.attrs.pickupRadius).toBe(180)
    expect(game.panelState().settings.autoPickup).toBe(false)
    game.restart(); game.setUiMode('menu')
    expect(game.practiceAction({ type: 'card-level', id: 'magnet', level: 3 })).toBe(true)
    expect(game.panelState().settings.autoPickup).toBe(false)
    game.setSetting('autoPickup', true); game.restart()
    expect(game.panelState().settings.autoPickup).toBe(true)
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
    input.reset.mockClear(); pointer.reset.mockClear()
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
