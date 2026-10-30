import { describe, expect, it } from 'vitest'
import { createKeyboardInput } from '../../src/input/keyboard'

function keyboard() {
  const target = new EventTarget()
  const input = createKeyboardInput(target as unknown as Window)
  const down = (code: string, options: Partial<KeyboardEvent> = {}) => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { code, repeat: false, ...options })
    target.dispatchEvent(event)
    return event
  }
  return { target, input, down }
}

describe('keyboard commands', () => {
  it.each(['KeyR', 'Escape'])('fires %s once per press, never from auto-repeat', (code) => {
    const { target, input, down } = keyboard()
    const consume = code === 'KeyR' ? input.consumeRestart : input.consumeMenuToggle
    expect(down(code).defaultPrevented).toBe(true)
    expect(consume()).toBe(true)
    down(code, { repeat: true })
    expect(consume()).toBe(false)
    target.dispatchEvent(Object.assign(new Event('keyup'), { code }))
    down(code)
    expect(consume()).toBe(true)
    input.dispose()
  })

  it('clears held combat keys and queued commands when restarting or losing focus', () => {
    const { target, input, down } = keyboard()
    for (const reset of [input.reset, () => target.dispatchEvent(new Event('blur'))]) {
      for (const code of ['KeyD', 'KeyE', 'KeyJ', 'KeyR', 'Escape']) down(code)
      expect(input.read().move.x).toBe(1)
      reset()
      expect(input.read()).toEqual({ move: { x: 0, y: 0 }, placeMine: false, skill: undefined, skills: [] })
      expect(input.consumeRestart()).toBe(false)
      expect(input.consumeMenuToggle()).toBe(false)
    }
    input.dispose()
  })

  it('leaves browser shortcuts such as Ctrl+R alone', () => {
    const { input, down } = keyboard()
    expect(down('KeyR', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(input.consumeRestart()).toBe(false)
    input.dispose()
  })
})
