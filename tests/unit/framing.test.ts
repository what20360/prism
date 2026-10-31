import { describe, expect, it } from 'vitest'
import { createMessageAssembler, frameMessage, MAX_WIRE_MESSAGE } from '../../src/net/framing'
describe('bounded RTC message framing', () => {
  it('reassembles large snapshots through small ordered data-channel messages', () => {
    const text = JSON.stringify({ protocol: 2, text: '棱晶'.repeat(60000) }), frames = frameMessage(text, 4), receive = createMessageAssembler()
    expect(frames.length).toBeGreaterThan(1); expect(frames.every((s) => s.length < 25000)).toBe(true)
    for (const frame of frames.slice(0, -1)) expect(receive(frame, 10)).toBeNull()
    expect(receive(frames.at(-1)!, 11)).toBe(text)
  })
  it('drops oversized, out-of-order and timed-out chunks, and can recover on a fresh frame', () => {
    const frames = frameMessage(JSON.stringify({ data: 'x'.repeat(30000) }), 1), receive = createMessageAssembler()
    expect(frameMessage('x'.repeat(MAX_WIRE_MESSAGE + 1), 1)).toEqual([])
    expect(receive(frames[1]!, 0)).toBeNull(); expect(receive(frames[0]!, 0)).toBeNull(); expect(receive(frames[1]!, 6000)).toBeNull()
    for (const frame of frames.slice(0, -1)) expect(receive(frame, 7000)).toBeNull()
    expect(receive(frames.at(-1)!, 7000)).toBe(JSON.stringify({ data: 'x'.repeat(30000) }))
  })
})
