import { describe, it, expect } from 'vitest'
import { LEVEL_SETS, pickLevelSet, silkDenRoom, SILK_CORE, SILK_CORRIDOR, SILK_PATH } from '../../src/content/levelSets'
import { buildDungeon } from '../../src/content/dungeon'
import { createRng } from '../../src/core/rng'
import { findPath, hasLineOfSight } from '../../src/core/navigation'
import { circleIntersectsRect, distance } from '../../src/core/collision'
import { createWorld } from '../../src/core/world'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { applyRoom } from '../../src/core/dungeon'
import { updateRoom, exitForRoom } from '../../src/core/systems/room'
describe('authored level sets and silk-den geometry', () => {
  it('selects reusable authored levels reproducibly and reaches every pool member', () => {
    const a = createRng(62), b = createRng(62), seen = new Set<string>()
    for (let i = 0; i < 50; i++) { const next = pickLevelSet(a, 'endless'); expect(next).toEqual(pickLevelSet(b, 'endless')); seen.add(next.design!.id) }
    expect(seen).toEqual(new Set(LEVEL_SETS.map((s) => s.id)))
  })
  it('has lower-right entry, one lower/left passage and two upper/right passages', () => {
    const room = silkDenRoom()
    expect(room.entry).toEqual(SILK_PATH[1]); expect(room.entry.x).toBeGreaterThan(SILK_CORE.x + SILK_CORE.width); expect(room.entry.y).toBeGreaterThan(SILK_CORE.y + SILK_CORE.height)
    expect(room.design!.core!.width).toBeCloseTo(SILK_CORRIDOR * 1.7)
    const horizontal = SILK_PATH.slice(1).filter((p, i) => p.y === SILK_PATH[i]!.y)
    const vertical = SILK_PATH.slice(1).filter((p, i) => p.x === SILK_PATH[i]!.x)
    expect(horizontal.filter((p) => p.y < SILK_CORE.y)).toHaveLength(2); expect(horizontal.filter((p) => p.y > SILK_CORE.y + SILK_CORE.height)).toHaveLength(1)
    expect(vertical.filter((p) => p.x > SILK_CORE.x + SILK_CORE.width)).toHaveLength(2); expect(vertical.filter((p) => p.x < SILK_CORE.x)).toHaveLength(1)
  })
  it('provides a connected winding route for player, worker and boss-sized circles without crossing walls', () => {
    const room = silkDenRoom(), goal = room.spawns[0]!.pos
    expect(hasLineOfSight(room.entry, goal, room.walls)).toBe(false)
    for (const radius of [25, 40, 64]) for (const target of room.design!.patrol) {
      const path = findPath(room, room.entry, target, radius); expect(path.length).toBeGreaterThan(0)
      let previous = room.entry
      for (const point of path) { expect(hasLineOfSight(previous, point, room.walls, radius)).toBe(true); previous = point }
    }
    const path = findPath(room, room.entry, goal, 40), points = [room.entry, ...path]
    expect(points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0)).toBeGreaterThan(3000)
    for (const anchor of room.design!.mineAnchors) expect(room.walls.some((w) => circleIntersectsRect(anchor.x, anchor.y, 64, w))).toBe(false)
  })
  it('makes silk-den the final dungeon encounter while higher difficulty retains pre-boss waves', () => {
    for (const difficulty of [1, 7] as const) {
      const rooms = buildDungeon({ seed: 11, difficulty }), final = rooms.at(-1)!, waves = [final.spawns, ...(final.waves ?? [])]
      expect(final.design?.id).toBe('silk-den'); expect(final.kind).toBe('boss')
      expect(waves.at(-1)!.filter((s) => s.behavior === 'weaver')).toHaveLength(1)
      expect(waves.slice(0, -1).flat().some((s) => s.tier === 'boss')).toBe(false)
      if (difficulty === 7) expect(waves.length).toBeGreaterThan(4)
    }
  })
  it('uses authored exit locations and carries design/bounds correctly across room transitions', () => {
    const initial = LEVEL_SETS[0]!.room(), authored = silkDenRoom()
    const w = createWorld({ seed: 5, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY, playerAttrs: PLAYER_BASE_ATTRS, room: initial })
    applyRoom(w, { ...authored, kind: 'combat', spawns: [] }); w.pendingSpawns = []; w.room.phase = 'combat'; updateRoom(w)
    expect(w.room.exit).toEqual(authored.design!.exit); expect(exitForRoom(w, true)).toEqual(authored.design!.skipExit)
    expect(w.room.design?.title).toBe('盘丝洞'); expect(w.victory).toBe(false)
    applyRoom(w, initial); expect(w.room.design!.id).toBe(initial.design!.id)
  })
})
