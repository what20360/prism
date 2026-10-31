import type { Rect, Vec2 } from '../core/types'
import type { RoomTemplate, RoomDesign } from '../core/world'
import { nextInt, type Rng } from '../core/rng'
import { ENEMIES } from './enemies'

export const LEVEL_BOUNDS: Rect = { x: 0, y: 0, width: 3200, height: 1800 }
export const STANDARD_WALLS: readonly (readonly { x: number; y: number; width: number; height: number }[])[] = [
  [
    { x: 600, y: 420, width: 180, height: 960 },
    { x: 2420, y: 420, width: 180, height: 960 },
    { x: 1000, y: 760, width: 180, height: 180 },
    { x: 2020, y: 760, width: 180, height: 180 },
  ],
  [
    { x: 1200, y: 300, width: 160, height: 440 },
    { x: 1840, y: 300, width: 160, height: 440 },
    { x: 1200, y: 1060, width: 160, height: 440 },
    { x: 1840, y: 1060, width: 160, height: 440 },
    { x: 880, y: 700, width: 260, height: 140 },
    { x: 2060, y: 700, width: 260, height: 140 },
  ],
  [
    { x: 700, y: 300, width: 300, height: 300 },
    { x: 2200, y: 300, width: 300, height: 300 },
    { x: 700, y: 1200, width: 300, height: 300 },
    { x: 2200, y: 1200, width: 300, height: 300 },
    { x: 1450, y: 820, width: 300, height: 160 },
  ],
]

export interface LevelSet { readonly id: string; readonly title: string; readonly kind: 'combat' | 'boss'; readonly modes: readonly ('dungeon' | 'endless')[]; room(): RoomTemplate }
const portal = (p: Vec2): Rect => ({ x: p.x - 90, y: p.y - 60, width: 180, height: 120 })
const centre = (r: Rect): Vec2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
export const SILK_CORRIDOR = 300
export const SILK_CORE: Rect = { x: 1200, y: 800, width: SILK_CORRIDOR * 1.7, height: SILK_CORRIDOR * 1.7 }
const gap = 64, half = SILK_CORRIDOR / 2, pitch = SILK_CORRIDOR + gap
const left = SILK_CORE.x - half - gap, innerRight = SILK_CORE.x + SILK_CORE.width + half + gap
const innerTop = SILK_CORE.y - half - gap, outerRight = innerRight + pitch, top = innerTop - pitch, bottom = SILK_CORE.y + SILK_CORE.height + half + gap
/** One lower/left passage, two upper/right passages; entry is the lower-right bend. */
export const SILK_PATH: readonly Vec2[] = [
  { x: left, y: bottom }, { x: outerRight, y: bottom }, { x: outerRight, y: top },
  { x: left, y: top }, { x: left, y: innerTop }, { x: innerRight, y: innerTop },
  { x: innerRight, y: centre(SILK_CORE).y }, centre(SILK_CORE),
]
/** Compress the complement of authored floor rectangles into nonoverlapping walls. */
export function wallsOutsideFloor(bounds: Rect, floor: readonly Rect[]): Rect[] {
  const xs = [...new Set([bounds.x, bounds.x + bounds.width, ...floor.flatMap((r) => [r.x, r.x + r.width])])].sort((a, b) => a - b)
  const ys = [...new Set([bounds.y, bounds.y + bounds.height, ...floor.flatMap((r) => [r.y, r.y + r.height])])].sort((a, b) => a - b)
  const walls: Rect[] = [], active = new Map<string, number>()
  for (let row = 0; row < ys.length - 1; row++) {
    let start: number | null = null
    const current = new Set<string>()
    for (let col = 0; col < xs.length; col++) {
      const x = xs[col]!, y = ys[row]!, next = xs[col + 1]
      const solid = next !== undefined && !floor.some((r) => (x + next) / 2 > r.x && (x + next) / 2 < r.x + r.width && (y + ys[row + 1]!) / 2 > r.y && (y + ys[row + 1]!) / 2 < r.y + r.height)
      if (solid && start === null) start = x
      if (!solid && start !== null) {
        const key = `${start}:${x - start}`, old = active.get(key), height = ys[row + 1]! - y
        if (old !== undefined) walls[old] = { ...walls[old]!, height: walls[old]!.height + height }
        else { active.set(key, walls.length); walls.push({ x: start, y, width: x - start, height }) }
        current.add(key); start = null
      }
    }
    for (const key of active.keys()) if (!current.has(key)) active.delete(key)
  }
  return walls
}
export function silkDenRoom(): RoomTemplate {
  const floor: Rect[] = [SILK_CORE]
  for (let i = 1; i < SILK_PATH.length; i++) {
    const a = SILK_PATH[i - 1]!, b = SILK_PATH[i]!
    floor.push({ x: Math.min(a.x, b.x) - half, y: Math.min(a.y, b.y) - half, width: Math.abs(a.x - b.x) + SILK_CORRIDOR, height: Math.abs(a.y - b.y) + SILK_CORRIDOR })
  }
  const entry = { ...SILK_PATH[1]! }, coreCentre = centre(SILK_CORE)
  const design: RoomDesign = { id: 'silk-den', title: '盘丝洞', theme: 'silk', corridorWidth: SILK_CORRIDOR, core: SILK_CORE,
    patrol: SILK_PATH, mineAnchors: [SILK_PATH[2]!, SILK_PATH[5]!], exit: portal(coreCentre), skipExit: portal({ x: entry.x - 240, y: entry.y }) }
  return { id: 'silk-den', kind: 'boss', bounds: LEVEL_BOUNDS, walls: wallsOutsideFloor(LEVEL_BOUNDS, floor), entry, design,
    spawns: [{ ...ENEMIES.weaver!, pos: coreCentre }] }
}
const names = [['prism-gallery', '折光回廊'], ['cross-bastion', '交错屏障'], ['four-pillars', '四柱工坊']] as const
export const LEVEL_SETS: readonly LevelSet[] = [
  ...names.map(([id, title], index): LevelSet => ({ id, title, kind: 'combat', modes: ['dungeon', 'endless'], room: () => ({ id, kind: 'combat', bounds: LEVEL_BOUNDS, walls: STANDARD_WALLS[index]!, entry: { x: 1600, y: 1560 }, spawns: [],
    design: { id, title, theme: 'prism', patrol: [{ x: 400, y: 400 }, { x: 2800, y: 400 }, { x: 1600, y: 1200 }], mineAnchors: [], exit: { x: 1480, y: 60, width: 240, height: 140 } } }) })),
  { id: 'silk-den', title: '盘丝洞', kind: 'boss', modes: ['dungeon', 'endless'], room: silkDenRoom },
]
export function pickLevelSet(rng: Rng, mode: 'dungeon' | 'endless', kind?: LevelSet['kind']): RoomTemplate {
  const choices = LEVEL_SETS.filter((set) => set.modes.includes(mode) && (kind === undefined || set.kind === kind))
  return choices[nextInt(rng, 0, choices.length)]!.room()
}

export function safeRoom(id: string): RoomTemplate { return { id, kind: 'safe', bounds: { x: 0, y: 0, width: 1000, height: 700 }, walls: [], entry: { x: 500, y: 560 }, spawns: [], design: { id: 'rest-chamber', title: '休整室', theme: 'prism', patrol: [{ x: 500, y: 300 }], mineAnchors: [], exit: { x: 410, y: 40, width: 180, height: 120 } } } }
