import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK, orderPreset, readPreset, validateTargets } from '../../src/app/upgradePlans'
describe('portable upgrade presets', () => {
  it('round-trips uncapped numeric goals and a five-slot quick bar independently of a run save', () => {
    const preset = { format: 'prism-build', version: 1, name: '飞剑实验', targets: [{ id: 'suspension', level: 50 }, { id: 'homing', level: 3 }], quickSlots: DEFAULT_QUICK }
    expect(readPreset(JSON.stringify(preset))).toEqual(preset)
    expect(() => readPreset('{"format":"prism-save","version":1}')).toThrow()
  })
  it('rejects invalid targets without silently changing the proposed build', () => {
    for (const targets of [[{ id: 'missing', level: 1 }], [{ id: 'ricochet', level: 2 }], [{ id: 'homing', level: -1 }], [{ id: 'gun-damage', level: 10000 }], [{ id: 'homing', level: 1 }, { id: 'homing', level: 2 }]]) expect(() => validateTargets(targets)).toThrow()
    expect(() => readPreset(JSON.stringify({ format: 'prism-build', version: 1, name: 'x', targets: [], quickSlots: ['unknown'] }))).toThrow()
  })
  it('orders priority modifiers and owned card prerequisites before dependent targets', () => {
    const result = orderPreset([{ id: 'reflect', level: 1 }, { id: 'deflect', level: 1 }, { id: 'armor', level: 5 }, { id: 'ricochet', level: 1 }, { id: 'gun-pierce', level: 1 }]).map((x) => x.id)
    expect(result.indexOf('armor')).toBeLessThan(result.indexOf('deflect'))
    expect(result.indexOf('deflect')).toBeLessThan(result.indexOf('reflect'))
    expect(result.indexOf('gun-pierce')).toBeLessThan(result.indexOf('ricochet'))
  })
})
