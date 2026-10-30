import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPointerInput } from '../../src/input/pointer'

describe('independent shooting and target lock pointer controls', () => {
  let surface: EventTarget
  let windowEvents: EventTarget
  beforeEach(() => { surface = new EventTarget(); windowEvents = new EventTarget(); vi.stubGlobal('window', windowEvents) })
  afterEach(() => vi.unstubAllGlobals())
  const press = (surface: EventTarget, button: number, pointerType = 'mouse', x = 300, y = 200) => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button, pointerType, clientX: x, clientY: y })
    surface.dispatchEvent(event); return event
  }
  it('left mouse only shoots and never queues or clears a manual lock', () => {
    const input = createPointerInput(surface as HTMLElement)
    press(surface, 0)
    expect(input.firing()).toBe(true); expect(input.consumeLock!()).toBeUndefined()
    expect(input.position()).toEqual({ x: 300, y: 200 })
    windowEvents.dispatchEvent(Object.assign(new Event('pointerup'), { button: 0 }))
    expect(input.firing()).toBe(false); input.dispose()
  })
  it('right mouse queues the selected point without firing or opening the context menu', () => {
    const input = createPointerInput(surface as HTMLElement)
    expect(press(surface, 2).defaultPrevented).toBe(true)
    expect(input.firing()).toBe(false); expect(input.consumeLock!()).toEqual({ x: 300, y: 200 })
    expect(input.consumeLock!()).toBeUndefined()
    const menu = new Event('contextmenu', { cancelable: true }); surface.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true); input.dispose()
  })
  it('permits right-lock while holding left fire and preserves the queued lock across left clicks', () => {
    const input = createPointerInput(surface as HTMLElement)
    press(surface, 0); press(surface, 2, 'mouse', 500, 100); press(surface, 0, 'mouse', 600, 200)
    expect(input.firing()).toBe(true); expect(input.consumeLock!()).toEqual({ x: 500, y: 100 })
    input.dispose()
  })
  it('touch taps lock without becoming an extra shooting control', () => {
    const input = createPointerInput(surface as HTMLElement)
    press(surface, 0, 'touch')
    expect(input.firing()).toBe(false); expect(input.position()).toBeNull()
    expect(input.consumeLock!()).toEqual({ x: 300, y: 200 }); input.dispose()
  })
  it('releases both queued selection and held fire on blur and removes handlers on dispose', () => {
    const input = createPointerInput(surface as HTMLElement)
    press(surface, 0); press(surface, 2); windowEvents.dispatchEvent(new Event('blur'))
    expect(input.firing()).toBe(false); expect(input.consumeLock!()).toBeUndefined()
    input.dispose(); press(surface, 0); press(surface, 2)
    expect(input.firing()).toBe(false); expect(input.consumeLock!()).toBeUndefined()
  })
})
