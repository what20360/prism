import { describe, expect, it } from 'vitest'
import { readDuelIntent } from '../../src/app/readIntent'
import { createDuelMatch } from '../../src/app/modes/duel'
import { toSnapshot } from '../../src/core/snapshot'
import { DEFAULT_SETTINGS } from '../../src/storage/config'
import type { PointerSource } from '../../src/input/pointer'

const keyboard = { read: () => ({ move: { x: 0, y: 0 } }), reset() {}, dispose() {}, consumeRestart: () => false, consumeMenuToggle: () => false }
const fingers = { read: () => ({ move: { x: 0, y: 0 } }), reset() {}, setPaused() {}, setVisible() {}, update() {}, dispose() {} }
const pointer: PointerSource = { position: () => ({ x: 0, y: 0 }), firing: () => false, reset() {}, dispose() {} }
const renderer = { draw() {}, dispose() {}, viewToWorld: (x: number, y: number) => ({ x, y }) }
describe('duel automatic control preferences', () => {
  it.each(['auto', 'manual'] as const)('honors %s aim and fire preferences when the cards are owned', (mode) => {
    const w = createDuelMatch(10, 'budget').world(), p = w.actors.get(1)!
    p.attrs = { ...p.attrs, autoAim: 1, autoFire: 1 }
    const result = readDuelIntent(toSnapshot(w, 1), keyboard, pointer, fingers, renderer, { ...DEFAULT_SETTINGS, aimMode: mode, fireMode: mode })
    expect(result.autoAim).toBe(mode === 'auto'); expect(result.fire).toBe(mode === 'auto')
  })
  it('cannot enable automatic controls through preferences alone and still accepts manual fire', () => {
    const snapshot = toSnapshot(createDuelMatch(10, 'budget').world(), 1), settings = { ...DEFAULT_SETTINGS, aimMode: 'auto', fireMode: 'auto' } as const
    const idle = readDuelIntent(snapshot, keyboard, pointer, fingers, renderer, settings)
    expect(idle.autoAim).toBe(false); expect(idle.fire).toBe(false)
    expect(readDuelIntent(snapshot, keyboard, { ...pointer, firing: () => true }, fingers, renderer, settings).fire).toBe(true)
  })
  it('maps right-click locks independently of left-button shooting', () => {
    const snapshot = toSnapshot(createDuelMatch(10, 'budget').world(), 1), other = snapshot.actors.find((a) => a.team !== 'player')!
    const intent = readDuelIntent(snapshot, keyboard, { ...pointer, consumeLock: () => ({ x: other.x, y: other.y }) }, fingers, renderer)
    expect(intent.lockTarget).toBe(other.id); expect(intent.fire).toBe(false)
  })
})
