import { describe, expect, it } from 'vitest'
import { armorToMitigation, resolveDamage } from '../../src/core/attrs'

describe('armor to mitigation', () => {
  it('is zero without armor', () => {
    expect(armorToMitigation(0)).toBe(0)
    expect(armorToMitigation(-10)).toBe(0)
  })

  it('follows armor / (100 + armor)', () => {
    expect(armorToMitigation(100)).toBeCloseTo(0.5, 10)
    expect(armorToMitigation(300)).toBeCloseTo(0.75, 10)
    expect(armorToMitigation(900)).toBeCloseTo(0.9, 10)
  })

  it('never reaches 100%', () => {
    expect(armorToMitigation(1e9)).toBeLessThan(1)
  })
})

describe('damage resolution', () => {
  it('applies mitigation', () => {
    expect(resolveDamage(100, 100, 0)).toBeCloseTo(50, 10)
  })

  it('reduces armor with penetration', () => {
    expect(resolveDamage(100, 100, 50)).toBeCloseTo(100 * (1 - 50 / 150), 10)
  })

  it('never goes negative', () => {
    expect(resolveDamage(10, 0, 0)).toBe(10)
    expect(resolveDamage(0, 500, 0)).toBe(0)
    expect(resolveDamage(100, 100, 10_000)).toBeCloseTo(100, 10)
  })
})
