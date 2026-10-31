import { ENEMIES } from '../../content/enemies'
import { PLAYER_BASE_ATTRS } from '../../content/player'
import { silkDenRoom } from '../../content/levelSets'
import { applyRoom, spawnPendingEnemies, type RoomSpec } from '../../core/dungeon'
import { reapplyAttrs } from '../../core/progress'
import { isFiniteBuild, resolveAttrs } from '../../core/cards'
import { getPlayer, type World, type EnemySpawnSpec } from '../../core/world'

export interface PracticeConfig {
  readonly block?: number
  readonly enemy?: string
  readonly scenario: 'targets' | 'combat'
  readonly layout: 'open' | 'cover' | 'silk-den'
  readonly count: number
  readonly hp: number
  readonly armor: number
  readonly invincible: boolean
  readonly freeCards: boolean
}
export const DEFAULT_PRACTICE: PracticeConfig = { block: 0, enemy: 'mixed', scenario: 'targets', layout: 'open', count: 3, hp: 10000, armor: 0, invincible: true, freeCards: true }
const CREDIT = 1e12
export interface PracticeState {
  readonly config: PracticeConfig
  readonly damage: number
  readonly recentDps: number
  readonly averageDps: number
  readonly seconds: number
  readonly kills: number
}
export type PracticeAction =
  | { readonly type: 'configure'; readonly config: PracticeConfig }
  | { readonly type: 'scene-reset' | 'meters-reset' | 'restore' | 'clear' | 'enter-core' }
  | { readonly type: 'card-level'; readonly id: string; readonly level: number }
export interface PracticeMode {
  room(): RoomSpec
  initialize(world: World): void
  beforeStep(world: World): void
  afterStep(world: World): void
  credit(world: World, price?: number): void
  state(world: World): PracticeState
  action(world: World, action: PracticeAction): boolean
}
function finite(value: number, fallback: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback }
function configOf(value: PracticeConfig): PracticeConfig {
  return { block: finite(value.block ?? 0, 0, 0, 10000), enemy: value.enemy && (Object.hasOwn(ENEMIES, value.enemy) || value.enemy === 'bark') ? value.enemy : 'mixed', scenario: value.scenario === 'combat' ? 'combat' : 'targets', layout: value.layout === 'silk-den' ? 'silk-den' : value.layout === 'cover' ? 'cover' : 'open',
    count: finite(value.count, 3, 1, 12), hp: finite(value.hp, 10000, 1, 100000), armor: finite(value.armor, 0, 0, 1000),
    invincible: value.invincible === true, freeCards: value.freeCards === true }
}
export function createPracticeMode(initial: PracticeConfig = DEFAULT_PRACTICE): PracticeMode {
  let config = configOf(initial), startTick = 0, damageBase = 0, killBase = 0, previousDamage = 0
  let samples: { tick: number; damage: number }[] = []
  const room = (): RoomSpec => {
    const authored = config.layout === 'silk-den' ? silkDenRoom() : undefined
    const spawns: EnemySpawnSpec[] = []
    for (let i = 0; i < config.count; i++) {
      const pos = authored ? config.enemy === 'weaver' ? authored.spawns[0]!.pos : authored.design!.patrol[(i + 2) % authored.design!.patrol.length]! : { x: 1600 + [0, -1, 1, -2, 2][i % 5]! * 400, y: 820 - Math.floor(i / 5) * 240 }
      if (config.scenario === 'targets') spawns.push({ pos, attrs: { ...PLAYER_BASE_ATTRS, maxHp: config.hp, armor: config.armor, block: config.block ?? 0,
        speed: 0, fireRate: 0, damage: 0, autoFire: 0 }, tier: 'normal', behavior: 'turret', contactDamage: 0, hasCore: i % 2 === 1, name: `${i % 2 ? '核心靶机' : '训练靶机'} ${i + 1}` })
      else {
        const types = ['drifter', 'turret', 'bomber', 'stalker', 'lancer', 'warden']; const id = config.enemy === 'mixed' ? types[i % types.length]! : config.enemy === 'bark' ? 'drifter' : config.enemy!
        const type = ENEMIES[id]!
        spawns.push({ ...type, pos, name: config.enemy === 'bark' ? '树皮·游荡者' : type.name, traits: config.enemy === 'bark' ? ['bark'] : type.traits, attrs: { ...type.attrs, maxHp: config.hp, armor: config.armor, block: config.enemy === 'bark' ? Math.max(6, config.block ?? 0) : config.block ?? type.attrs.block } })
      }
    }
    if (authored) return { ...authored, id: 'practice-silk', kind: 'combat', pickups: [], spawns }
    return { id: 'practice', kind: 'combat', pickups: [], bounds: { x: 0, y: 0, width: 3200, height: 1800 },
      entry: { x: 1600, y: 1280 }, walls: config.layout === 'cover' ? [{ x: 850, y: 950, width: 240, height: 160 }, { x: 2110, y: 950, width: 240, height: 160 }, { x: 1450, y: 420, width: 300, height: 130 }] : [], spawns }
  }
  const credit = (world: World, price = 0) => { if (config.freeCards) world.shards = Math.max(CREDIT, Number.isFinite(price) ? price : 0) }
  const resetMeters = (world: World) => { startTick = world.tick; damageBase = world.stats.damageDealt; killBase = world.stats.kills; previousDamage = world.stats.damageDealt; samples = [] }
  const restore = (world: World) => {
    const p = getPlayer(world); p.hp = p.attrs.maxHp; p.shield = p.attrs.shield
    p.iframesTicks = 0; p.fireCooldownTicks = 0; p.mineCooldownTicks = 0
    p.deflectWindowTicks = 0; p.deflectCooldownTicks = 0; p.rageTicks = 0; p.dashTicks = 0; p.rageCooldownTicks = 0; p.dashCooldownTicks = 0; p.burstRemaining = 0; p.laserTicks = 0; p.laserTimer = 0; p.burn = undefined; p.shockTicks = 0
  }
  const resetScene = (world: World) => {
    const player = getPlayer(world)
    for (const [id, actor] of world.actors) if (actor.team === 'enemy') world.actors.delete(id)
    world.nextEntityId = player.id + 1; world.rng.state = world.seed >>> 0
    applyRoom(world, room()); spawnPendingEnemies(world)
    world.room.phase = 'combat'; world.roomCleared = false; world.room.exit = null; world.exitReached = false
    world.floaters = []; world.gameOver = false; world.victory = false; world.playerTookHit = false
    world.tick = 0; world.score = 0; world.revivesUsed = 0
    world.stats = { kills: 0, coreHits: 0, chain: 0, chainIdleTicks: 0, bestChain: 0, damageDealt: 0, damageTaken: 0 }
    const p = getPlayer(world); p.intent = { move: { x: 0, y: 0 }, fire: false }; p.aimAngle = -Math.PI / 2
    world.shards = config.freeCards ? CREDIT : 1000
    restore(world); credit(world); resetMeters(world)
  }
  return {
    room, initialize: resetScene, credit,
    beforeStep: (world) => { credit(world); const p = getPlayer(world); if (config.invincible) p.iframesTicks = Math.max(2, p.iframesTicks) },
    afterStep: (world) => {
      const gained = Math.max(0, world.stats.damageDealt - previousDamage)
      if (gained > 0) samples.push({ tick: world.tick, damage: gained })
      previousDamage = world.stats.damageDealt
      samples = samples.filter((sample) => sample.tick > world.tick - 180)
      if (config.scenario === 'targets') for (const actor of world.actors.values()) if (actor.team === 'enemy' && !actor.alive) { actor.alive = true; actor.hp = actor.attrs.maxHp; actor.damageFlashTicks = 0 }
      world.room.exit = null; world.exitReached = false; world.roomCleared = false; world.room.phase = 'combat'; credit(world)
    },
    state: (world) => {
      const seconds = Math.max(0, (world.tick - startTick) / 60), damage = Math.max(0, world.stats.damageDealt - damageBase)
      return { config: { ...config }, damage, seconds, recentDps: samples.reduce((total, sample) => total + sample.damage, 0) / 3,
        averageDps: seconds > 0 ? damage / seconds : 0, kills: Math.max(0, world.stats.kills - killBase) }
    },
    action: (world, action) => {
      if (action.type === 'configure') { config = configOf(action.config); resetScene(world) }
      else if (action.type === 'scene-reset') resetScene(world)
      else if (action.type === 'meters-reset') resetMeters(world)
      else if (action.type === 'restore') restore(world)
      else if (action.type === 'enter-core' && world.room.design?.core) { const p = getPlayer(world), core = world.room.design.core; p.pos = { x: core.x + p.radius + 24, y: core.y + core.height * 0.75 }; p.iframesTicks = 120 }
      else if (action.type === 'clear') { world.projectiles = []; world.mines = []; world.traces = []; getPlayer(world).burstRemaining = 0; getPlayer(world).laserTicks = 0 }
      else if (action.type === 'card-level') {
        const card = world.registry.get(action.id)
        if (!card || !Number.isSafeInteger(action.level) || action.level < 0 || (card.maxLevel !== undefined && action.level > card.maxLevel)) return false
        const purchases = world.purchases.filter((purchase) => purchase.id !== action.id)
        // Granted levels have no payment history; do not allocate one entry per level.
        if (action.level > 0) purchases.push({ id: action.id, level: action.level, paid: [] })
        if (!isFiniteBuild(resolveAttrs(world.basePlayerAttrs, purchases, world.registry))) return false
        world.purchases = purchases
        reapplyAttrs(world, getPlayer(world)); credit(world)
      }
      return true
    },
  }
}
