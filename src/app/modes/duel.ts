import { DUEL_RULES, DUEL_ATTRS, DUEL_BUILD_ATTRS, DUEL_ECONOMY, duelCardRestrictions, type DuelMode, type DuelAction, type DuelPhase, type DuelWinner, type DuelState } from '../../content/duel'
export { DUEL_RULES, DUEL_ATTRS, type DuelState } from '../../content/duel'
import { CARD_REGISTRY } from '../../content/cards'
import { ENEMIES } from '../../content/enemies'
import type { Intent } from '../../core/controller'
import { createActor, createWorld, type World } from '../../core/world'
import { spawnLoot } from '../../core/loot'
import { purchaseLevel } from '../../core/cards'
import { buyCard, listCardStates, sellCard } from '../../core/progress'
import { equipSkill } from '../../core/systems/skills'
import { resolveSpawnPosition } from '../../core/collision'
import { nextInt } from '../../core/rng'
import { step } from '../../core/simulation'
import { validateTargets, moveTarget, removeTarget, type PurchasePlan } from '../upgradePlans'
import { createPurchaseQueue, type PurchaseNotice } from '../purchaseQueue'
import { withMonsterTraits } from '../../content/monsterTraits'
export interface DuelMatch {
  world(): World; state(): DuelState; ready(seat: 0 | 1): void; tick(host: Intent, guest: Intent): void; forfeit(seat: 0 | 1): void
  action(seat: 0 | 1, action: DuelAction): boolean
  showOffers(seat: 0 | 1, visible: boolean): void
}
export function createDuelMatch(seed: number, mode: DuelMode = 'fixed'): DuelMatch {
  let round = 0, phase: DuelPhase = 'preparing', wins: [number, number] = [0, 0], ready: [boolean, boolean] = [false, false]
  let countdown = 0, remaining = DUEL_RULES.roundTicks as number, winner: DuelWinner = null
  const plans: [PurchasePlan, PurchasePlan] = [{ enabled: true, targets: [], quickMode: 'planned' }, { enabled: true, targets: [], quickMode: 'planned' }]
  const queues = [createPurchaseQueue(), createPurchaseQueue()] as const
  const offersVisible = [true, true]
  let notices: [PurchaseNotice | null, PurchaseNotice | null] = [null, null], resourceAt = 0, monsterAt = 0
  const base = mode === 'fixed' ? DUEL_ATTRS : DUEL_BUILD_ATTRS
  const makeWorld = (nextRound: number) => {
    const hostX = nextRound % 2 === 1 ? 500 : 1700, guestX = 2200 - hostX
    const created = createWorld({ seed: (seed + Math.max(1, nextRound) * 997) >>> 0, registry: CARD_REGISTRY, economy: DUEL_ECONOMY, playerAttrs: { ...base }, playerDamageIframesTicks: 0, room: {
      id: 'duel', kind: 'safe', bounds: { x: 0, y: 0, width: 2200, height: 1400 }, walls: [
        { x: 1040, y: 220, width: 120, height: 260 }, { x: 1040, y: 920, width: 120, height: 260 },
      ], entry: { x: hostX, y: 700 }, pickups: [], spawns: [{ pos: { x: guestX, y: 700 }, attrs: { ...base },
        tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: true, damageIframesTicks: 0, name: '对手' }],
    } })
    created.participants = { 1: { shards: mode === 'fixed' ? 0 : DUEL_RULES.initialShards, purchases: [], revivesUsed: 0 }, 2: { shards: mode === 'fixed' ? 0 : DUEL_RULES.initialShards, purchases: [], revivesUsed: 0 } }
    created.resourceDrops = mode === 'resource'; created.monsterShardDrop = mode === 'resource' ? DUEL_RULES.monsterDrop : 0
    created.cardRestrictions = duelCardRestrictions(mode)
    created.room.phase = 'idle'; created.actors.get(1)!.aimAngle = hostX < guestX ? 0 : Math.PI; created.actors.get(2)!.aimAngle = hostX < guestX ? Math.PI : 0
    resourceAt = nextInt(created.rng, DUEL_RULES.resourceMinTicks, DUEL_RULES.resourceMaxTicks + 1)
    monsterAt = nextInt(created.rng, DUEL_RULES.monsterMinTicks, DUEL_RULES.monsterMaxTicks + 1)
    for (const queue of queues) queue.reset()
    notices = [null, null]
    return created
  }
  let world = makeWorld(1)
  const finishRound = (result: DuelWinner) => {
    winner = result; ready = [false, false]
    if (result === 0 || result === 1) wins[result]++
    phase = Math.max(...wins) >= DUEL_RULES.winsNeeded ? 'finished' : 'round-over'
    if (phase === 'round-over') world = makeWorld(round + 1)
    else { world.projectiles = []; world.mines = []; world.pickups = []; notices = [null, null] }
  }
  const spawnPosition = (radius: number) => {
    for (let i = 0; i < 24; i++) {
      const p = resolveSpawnPosition({ x: nextInt(world.rng, 160, 2040), y: nextInt(world.rng, 140, 1260) }, radius, world.room.walls, world.room.bounds)
      if ([1, 2].every((id) => Math.hypot(p.x - world.actors.get(id)!.pos.x, p.y - world.actors.get(id)!.pos.y) > radius + 180)) return p
    }
    return null
  }
  const resources = () => {
    const elapsed = DUEL_RULES.roundTicks - remaining
    if (elapsed % DUEL_RULES.incomeTicks === 0) for (const progress of Object.values(world.participants!)) progress.shards += DUEL_RULES.income
    if (elapsed >= resourceAt) {
      resourceAt = elapsed + nextInt(world.rng, DUEL_RULES.resourceMinTicks, DUEL_RULES.resourceMaxTicks + 1)
      const pos = world.pickups.length < DUEL_RULES.pickupLimit ? spawnPosition(16) : null
      if (pos) { const kind = nextInt(world.rng, 0, 4) === 0 ? 'blood' : 'shard'; spawnLoot(world, kind, pos, kind === 'blood' ? 12 : nextInt(world.rng, 8, 15), 30 * 60) }
    }
    if (elapsed >= monsterAt) {
      monsterAt = elapsed + nextInt(world.rng, DUEL_RULES.monsterMinTicks, DUEL_RULES.monsterMaxTicks + 1)
      if ([...world.actors.values()].filter((a) => a.alive && a.team === 'neutral').length >= DUEL_RULES.monsterLimit) return
      const kinds = ['drifter', 'turret', 'stalker', 'bomber', 'lancer'], type = ENEMIES[kinds[nextInt(world.rng, 0, kinds.length)]!]!, pos = spawnPosition(type.attrs.radius)
      if (pos) createActor(world, { ...withMonsterTraits({ ...type, pos }, world.rng, 2), team: 'neutral' })
    }
  }
  return {
    world: () => world,
    state: () => ({ mode, round, phase, wins: [...wins], ready: [...ready], countdown, remaining, winner, plans: structuredClone(plans), notices: structuredClone(notices) }),
    showOffers: (seat, visible) => { offersVisible[seat] = visible; if (!visible) { queues[seat].reset(); notices[seat] = null } },
    ready: (seat) => {
      if (phase !== 'preparing' && phase !== 'round-over' && phase !== 'finished') return
      ready[seat] = true
      if (!ready.every(Boolean)) return
      if (phase === 'finished') { wins = [0, 0]; round = 0; world = makeWorld(1); if (mode !== 'fixed') { phase = 'preparing'; ready = [false, false]; return } }
      round++; winner = null; countdown = DUEL_RULES.countdown; remaining = DUEL_RULES.roundTicks; phase = 'countdown'
    },
    tick: (host, guest) => {
      if (phase === 'countdown') { if (--countdown <= 0) phase = 'fighting'; return }
      if (phase !== 'fighting') return
      const clean = (intent: Intent, id: number): Intent => ({ ...intent, autoAim: intent.autoAim === true && world.actors.get(id)!.attrs.autoAim > 0,
        fire: intent.fire === true, autoPickup: intent.autoPickup !== false })
      step(world, new Map([[1, clean(host, 1)], [2, clean(guest, 2)]])); remaining--
      world.projectiles = world.projectiles.slice(-DUEL_RULES.projectileLimit)
      while (world.mines.length > DUEL_RULES.mineLimit) { const child = world.mines.findIndex((m) => m.child); world.mines.splice(child < 0 ? 0 : child, 1) }
      world.effects = world.effects.slice(-64); world.floaters = world.floaters.slice(-64)
      const a = world.actors.get(1)!, b = world.actors.get(2)!
      if (!a.alive || !b.alive) finishRound(!a.alive && !b.alive ? 'draw' : a.alive ? 0 : 1)
      else if (remaining <= 0) {
        const difference = a.hp / a.attrs.maxHp - b.hp / b.attrs.maxHp
        finishRound(Math.abs(difference) < 1e-8 ? 'draw' : difference > 0 ? 0 : 1)
      }
      if (phase !== 'fighting') return
      if (mode === 'resource') resources()
      if (mode !== 'fixed') for (const seat of [0, 1] as const) {
        if (offersVisible[seat]) notices[seat] = queues[seat].update(plans[seat], listCardStates(world, seat + 1), 1, (id) => buyCard(world, id, seat + 1).ok, true)
        else { queues[seat].reset(); notices[seat] = null }
      }
      for (const [id, actor] of world.actors) if (!actor.alive && !world.participants![id]) world.actors.delete(id)
    },
    action: (seat, action) => {
      if (mode === 'fixed' || (phase !== 'preparing' && phase !== 'round-over' && phase !== 'fighting') || (phase !== 'fighting' && ready[seat])) return false
      const id = seat + 1, plan = plans[seat]
      try {
        if (action.kind === 'buy') return buyCard(world, action.id, id).ok
        if (action.kind === 'sell') return sellCard(world, action.id, id)
        if (action.kind === 'equip') return equipSkill(world.actors.get(id)!, action.slot, action.id)
        if (action.kind === 'plan') plan.targets = validateTargets(action.targets)
        else if (action.kind === 'auto') plan.enabled = action.enabled
        else if (action.kind === 'quick-mode') plan.quickMode = action.mode
        else if (action.kind === 'queue') {
          const level = action.level ?? Math.max(purchaseLevel(world.participants![id]!.purchases, action.id), ...plan.targets.filter((t) => t.id === action.id).map((t) => t.level)) + 1
          plan.targets = validateTargets([...plan.targets, { id: action.id, level }])
        } else if (action.kind === 'move') {
          const other = action.index + action.direction
          if (action.index < 0 || other < 0 || action.index >= plan.targets.length || other >= plan.targets.length) return false
          plan.targets = moveTarget(plan.targets, action.index, action.direction)
        } else if (action.kind === 'remove') { if (action.index < 0 || action.index >= plan.targets.length) return false; plan.targets = removeTarget(plan.targets, action.index, (card) => purchaseLevel(world.participants![id]!.purchases, card)) }
        queues[seat].reset(); notices[seat] = null
        return true
      } catch { return false }
    },
    forfeit: (seat) => { if (phase === 'finished') return; winner = seat === 0 ? 1 : 0; wins[winner] = DUEL_RULES.winsNeeded; phase = 'finished'; ready = [false, false]; world.projectiles = []; world.mines = []; notices = [null, null] },
  }
}
