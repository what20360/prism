import { DUEL_RULES, DUEL_ATTRS, type DuelPhase, type DuelWinner, type DuelState } from '../../content/duel'
export { DUEL_RULES, DUEL_ATTRS, type DuelState } from '../../content/duel'
import { CARD_REGISTRY } from '../../content/cards'
import { DEFAULT_ECONOMY } from '../../content/economy'
import type { Intent } from '../../core/controller'
import { createWorld, type World } from '../../core/world'
import { step } from '../../core/simulation'
export interface DuelMatch { world(): World; state(): DuelState; ready(seat: 0 | 1): void; tick(host: Intent, guest: Intent): void; forfeit(seat: 0 | 1): void }
export function createDuelMatch(seed: number): DuelMatch {
  let round = 0, phase: DuelPhase = 'preparing', wins: [number, number] = [0, 0], ready: [boolean, boolean] = [false, false]
  let countdown = 0, remaining = DUEL_RULES.roundTicks as number, winner: DuelWinner = null
  const makeWorld = () => {
    const hostX = round % 2 === 0 ? 500 : 1700, guestX = 2200 - hostX
    const world = createWorld({ seed, registry: CARD_REGISTRY, economy: DEFAULT_ECONOMY, playerAttrs: { ...DUEL_ATTRS }, room: {
      id: 'duel', kind: 'safe', bounds: { x: 0, y: 0, width: 2200, height: 1400 }, walls: [
        { x: 1040, y: 220, width: 120, height: 260 }, { x: 1040, y: 920, width: 120, height: 260 },
      ], entry: { x: hostX, y: 700 }, pickups: [], spawns: [{ pos: { x: guestX, y: 700 }, attrs: { ...DUEL_ATTRS },
        tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: true, damageIframesTicks: 30, name: '对手' }],
    } })
    world.room.phase = 'idle'; world.actors.get(1)!.aimAngle = hostX < guestX ? 0 : Math.PI; world.actors.get(2)!.aimAngle = hostX < guestX ? Math.PI : 0
    return world
  }
  let world = makeWorld()
  const finishRound = (result: DuelWinner) => {
    winner = result; ready = [false, false]
    if (result === 0 || result === 1) wins[result]++
    phase = Math.max(...wins) >= DUEL_RULES.winsNeeded ? 'finished' : 'round-over'
    world.projectiles = []; world.mines = []; world.roomCleared = false; world.room.exit = null
  }
  return { world: () => world, state: () => ({ round, phase, wins: [...wins], ready: [...ready], countdown, remaining, winner }),
    ready: (seat) => {
      if (phase !== 'preparing' && phase !== 'round-over' && phase !== 'finished') return
      ready[seat] = true
      if (!ready.every(Boolean)) return
      if (phase === 'finished') { wins = [0, 0]; round = 0 }
      round++; winner = null; countdown = DUEL_RULES.countdown; remaining = DUEL_RULES.roundTicks; world = makeWorld(); phase = 'countdown'
    },
    tick: (host, guest) => {
      if (phase === 'countdown') { if (--countdown <= 0) phase = 'fighting'; return }
      if (phase !== 'fighting') return
      step(world, new Map([[1, host], [2, guest]])); remaining--
      const a = world.actors.get(1)!, b = world.actors.get(2)!
      if (!a.alive || !b.alive) finishRound(!a.alive && !b.alive ? 'draw' : a.alive ? 0 : 1)
      else if (remaining <= 0) {
        const difference = a.hp / a.attrs.maxHp - b.hp / b.attrs.maxHp
        finishRound(Math.abs(difference) < 1e-8 ? 'draw' : difference > 0 ? 0 : 1)
      }
      world.roomCleared = false; world.room.exit = null; world.shards = 0
    },
    forfeit: (seat) => { if (phase === 'finished') return; winner = seat === 0 ? 1 : 0; wins[winner] = DUEL_RULES.winsNeeded; phase = 'finished'; ready = [false, false]; world.projectiles = []; world.mines = [] },
  }
}
