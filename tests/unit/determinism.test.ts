import { describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { buildDungeon } from '../../src/content/dungeon'
import type { Intent } from '../../src/core/controller'
import { hashWorld } from '../../src/core/hash'
import { step } from '../../src/core/simulation'
import type { EntityId } from '../../src/core/types'
import { createWorld, getPlayer } from '../../src/core/world'

const SCRIPT: readonly { ticks: number; move: Intent['move'] }[] = [
  { ticks: 40, move: { x: 1, y: 0 } },
  { ticks: 40, move: { x: 0, y: 1 } },
  { ticks: 40, move: { x: -1, y: 0 } },
  { ticks: 40, move: { x: -1, y: -1 } },
]

function runScript(seed: number): string {
  const combatRoom = buildDungeon()[1]
  if (!combatRoom) throw new Error('dungeon is missing a combat room')

  const world = createWorld({
    seed,
    room: combatRoom,
    economy: DEFAULT_ECONOMY,
    registry: CARD_REGISTRY,
    playerAttrs: PLAYER_BASE_ATTRS,
  })

  const player = getPlayer(world)
  const intents = new Map<EntityId, Intent>()

  for (const phase of SCRIPT) {
    intents.set(player.id, { move: phase.move })
    for (let i = 0; i < phase.ticks; i += 1) step(world, intents)
  }

  return hashWorld(world)
}

describe('determinism', () => {
  it('produces identical state hashes for identical seeds and intents', () => {
    expect(runScript(7)).toBe(runScript(7))
  })

  it('differs when the seed differs', () => {
    expect(runScript(7)).not.toBe(runScript(8))
  })

  it('does not depend on wall-clock time', () => {
    expect(runScript(42)).toBe(runScript(42))
  })
})