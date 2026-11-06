import { ENEMIES } from '../../content/enemies'
import { endlessEncounter, encounterEnemy, RELAY_ANCHORS, type EncounterId } from '../../content/encounters'
import { withMonsterTraits, clampMonsterStats } from '../../content/monsterTraits'
import { applyRoom, type RoomSpec } from '../../core/dungeon'
import { circleIntersectsRect, distance } from '../../core/collision'
import { createRoomPickups } from '../../core/roomResources'
import { createRng, nextFloat, type Rng } from '../../core/rng'
import { exitForRoom } from '../../core/systems/room'
import { pickLevelSet } from '../../content/levelSets'
import type { Vec2 } from '../../core/types'
import { getPlayer, spawnEnemy, type EnemySpawnSpec, type World } from '../../core/world'

export const ENDLESS_RULES = { tailAlpha: 2.5, finiteMin: 0.5, finiteMax: 2.5, respawnTicks: 60,
  growth: { maxHp: 1.18, damage: 1.13, armor: 1.09, speed: 1.012, bulletSpeed: 1.015, fireRate: 1.01, range: 1.008, block: 1.08 } } as const
const ARENA = { x: 0, y: 0, width: 3200, height: 1800 }, ENTRY = { x: 1600, y: 1560 }
const finite = (value: number) => Math.min(Number.MAX_VALUE / 1e6, value)
export function endlessCount(floor: number): number { return 4 + Math.ceil(2 * Math.sqrt(floor)) }
export function endlessReward(replacements: number, population: number): number { return (1 + replacements / population) ** -2 }
export function worldSeed(text: string): number {
  if (!text.trim()) return 20261030
  if (/^\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text))) return Number(text) >>> 0
  let value = 2166136261
  for (const character of text.trim() || '20261030') value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return value >>> 0
}
/** A finite-mean Pareto tail; open floors perform no floor-strength truncation. */
export function endlessFactor(rng: Rng, open: boolean): number {
  const value = (1 - 1 / ENDLESS_RULES.tailAlpha) / (1 - nextFloat(rng)) ** (1 / ENDLESS_RULES.tailAlpha)
  return open ? value : Math.max(ENDLESS_RULES.finiteMin, Math.min(ENDLESS_RULES.finiteMax, value))
}
export function rollEndlessEnemy(floor: number, rng: Rng, open = floor % 5 === 0, preferred?:string): EnemySpawnSpec {
  const typeRoll = nextFloat(rng), type = ENEMIES[preferred??(typeRoll < 0.3 ? 'drifter' : typeRoll < 0.46 ? 'turret' : typeRoll < 0.64 ? 'stalker' : typeRoll < 0.8 ? 'bomber' : typeRoll < 0.86 ? 'bulwark' : typeRoll < 0.92 ? 'arc-rider' : typeRoll < 0.97 ? 'warden' : 'lancer')]!
  const factor = endlessFactor(rng, open), elite = type.hasCore || type.tier==='elite'
  const stat = (base: number, growth: number, exponent = 1, bias = 1): number => {
    const mean = finite(base * growth ** (floor - 1))
    const result = finite(mean * factor ** exponent * bias * (0.8 + 0.4 * nextFloat(rng)))
    return open ? result : Math.min(result, finite(mean * ENDLESS_RULES.finiteMax))
  }
  const g = ENDLESS_RULES.growth
  const attrs = { ...type.attrs,
    maxHp: stat(50, g.maxHp, 1, elite ? 1.6 : type.attrs.maxHp / 50), damage: stat(9, g.damage, 0.7, Math.max(0.7, type.attrs.damage / 13)), armor: stat(15, g.armor, 0.5, elite ? 1.2 : 0.6), block: stat(3, g.block, 0.5, elite ? 1 : 0.25),
    speed: type.attrs.speed > 0 ? stat(185, g.speed, 0.2, type.attrs.speed / 185) : 0,
    bulletSpeed: stat(430, g.bulletSpeed, 0.2), fireRate: type.attrs.fireRate > 0 ? stat(0.8, g.fireRate, 0.2, type.attrs.fireRate / 0.8) : 0,
    range: stat(900, g.range, 0.1), shield: 0, shieldCapMult:0,
  }
  let result = withMonsterTraits({ pos: { x: 1600, y: 400 }, attrs, tier: elite ? 'elite' : 'normal', behavior: type.behavior,
    contactDamage: type.contactDamage > 0 ? attrs.damage : 0, hasCore: type.hasCore, attackType: type.attackType, traits: type.traits,
    name: `${open && factor > ENDLESS_RULES.finiteMax ? '异常·' : ''}${type.name}` }, rng, Math.sqrt(floor))
  if (!open) {
    const upper = ENDLESS_RULES.finiteMax
    result = { ...result, attrs: clampMonsterStats(result.attrs, { maxHp: finite(50 * g.maxHp ** (floor - 1) * upper), damage: finite(9 * g.damage ** (floor - 1) * upper),
      armor: finite(15 * g.armor ** (floor - 1) * upper), block: finite(3 * g.block ** (floor - 1) * upper), speed: finite(185 * g.speed ** (floor - 1) * upper),
      bulletSpeed: finite(430 * g.bulletSpeed ** (floor - 1) * upper), fireRate: finite(0.8 * g.fireRate ** (floor - 1) * upper), range: finite(900 * g.range ** (floor - 1) * upper),
      physicalResist: 60, electricResist: 60, heatResist: 60 }) }
  }
  return { ...result, contactDamage: type.contactDamage > 0 ? result.attrs.damage : 0 }

}
export interface EndlessState {
  readonly seed: number; readonly floor: number; readonly open: boolean; readonly initialCount: number
  readonly alive: number; readonly pending: number; readonly respawned: number; readonly nextReward: number
  readonly rngState: number; readonly spawnQueue: readonly number[]
}
export interface EndlessMode {
  floor():number
  room(): RoomSpec
  initialize(world: World): void
  afterStep(world: World): void
  advance(world: World): void
  state(world: World): EndlessState
  checkpoint(): EndlessCheckpoint
  restore(world: World, saved: EndlessCheckpoint): void
}
export interface EndlessCheckpoint { readonly floor: number; readonly rngState: number; readonly respawned: number; readonly spawnQueue: readonly number[] }
export function createEndlessMode(): EndlessMode {
  let floor = 1, seed = 0, rng = createRng(0), population = 0, respawned = 0, queue: number[] = []
  const room = (): RoomSpec => ({ id: 'endless', kind: 'combat', bounds: ARENA, walls: [], entry: ENTRY, spawns: [], pickups: [] })
  let currentEntry: Vec2 = ENTRY, currentPatrol: readonly Vec2[] = []
  const getEntry = () => currentEntry
  const freePosition = (walls: RoomSpec['walls'], radius: number, avoid: readonly Vec2[], occupied: readonly {pos:Vec2;radius:number}[]=[], side=0): Vec2 => {
    const valid=(pos:Vec2)=>distance(pos,getEntry())>=550&&avoid.every(p=>distance(pos,p)>=650)&&!walls.some(wall=>circleIntersectsRect(pos.x,pos.y,radius+8,wall))&&occupied.every(o=>distance(pos,o.pos)>=radius+o.radius+20)
    for (let i = 0; i < 160; i++) {
      const x=side===0?100+nextFloat(rng)*3000:side<0?100+nextFloat(rng)*1400:1700+nextFloat(rng)*1400
      const pos = { x, y: 300 + nextFloat(rng) * 1100 }
      if(valid(pos))return pos
    }
    for (const pos of [...currentPatrol, { x: 1600, y: 400 }, { x: 1600, y: 1000 }, { x: 400, y: 400 }, { x: 2800, y: 400 }]) if(valid(pos))return pos
    // Never place a unit inside solid geometry, even in a densely packed authored room.
    for(const pos of currentPatrol)if(!walls.some(w=>circleIntersectsRect(pos.x,pos.y,radius+8,w)))return pos
    return { x: 1600, y: 400 }
  }

  const enter = (world: World) => {
    rng = createRng((seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0)
    population = Math.ceil(endlessCount(floor) * (world.coop ? 1+0.7*(Math.max(1,world.coop.members.filter(m=>m.connected).length)-1) : 1)); if(world.coop)world.coop.roomPartySize=Math.max(1,world.coop.members.filter(m=>m.connected).length); respawned = 0; queue = []
    const selected = pickLevelSet(rng, 'endless', floor < 5 ? 'combat' : undefined), encounter=endlessEncounter(seed,floor)
    const allowed=['drifter','turret','stalker','bomber',...(floor>=2?['arc-rider','charger']:[]),...(floor>=3?['bulwark','lancer','warden']:[])]
    currentEntry = selected.entry; currentPatrol = selected.design?.patrol ?? []
    const geometry = { ...selected, design:selected.design?{...selected.design,encounter}:undefined, kind: 'combat' as const, id: `endless-${floor}` }, walls = geometry.walls
    let chargers=0
    const occupied:{pos:Vec2;radius:number}[]=[]
    const spawns = Array.from({ length: population }, (_, index) => {
      let type=encounterEnemy(encounter,Math.max(0,index-(selected.design?.id==='relay-station'?2:0)),allowed);if(type==='charger'&&chargers>=2)type='drifter';if(type==='charger')chargers++
      const spec = rollEndlessEnemy(floor, rng, floor%5===0, type)
      if(selected.design?.id==='relay-station'&&index<2){const relay=ENEMIES.relay!,pos=RELAY_ANCHORS[index]!;occupied.push({pos,radius:relay.attrs.radius});return {...relay,attrs:{...relay.attrs,maxHp:Math.min(spec.attrs.maxHp,90*1.18**(floor-1))},pos,rewardMultiplier:0}}
      if (index === 0 && selected.design?.id === 'silk-den') {
        const q = selected.spawns[0]!, g = ENDLESS_RULES.growth, open = floor % 5 === 0
        const attrs = { ...q.attrs, maxHp: Math.min(finite(spec.attrs.maxHp * (open ? 8 : 2)), open ? Number.MAX_VALUE : finite(50 * g.maxHp ** (floor - 1) * ENDLESS_RULES.finiteMax)),
          damage: spec.attrs.damage, armor: spec.attrs.armor, block: spec.attrs.block, speed: Math.min(spec.attrs.speed || 150, floor % 5 === 0 ? Number.MAX_VALUE : finite(185 * g.speed ** (floor - 1) * ENDLESS_RULES.finiteMax) / 1.3), bulletSpeed: spec.attrs.bulletSpeed,
          range: spec.attrs.range, mineDamage: finite(spec.attrs.damage * 1.8), mineHp: Math.max(10, spec.attrs.maxHp * 0.2) }
        occupied.push({pos:q.pos,radius:attrs.radius});return { ...q, attrs, rewardMultiplier: 1 }
      }
      let pos=freePosition(walls,spec.attrs.radius,[geometry.entry],occupied,index%2? -1:1)
      if(selected.design?.id==='relay-station'&&index>=2&&index<6){const anchor=RELAY_ANCHORS[(index-2)%2]!;for(let attempt=0;attempt<40;attempt++){const p={x:anchor.x+(nextFloat(rng)-.5)*520,y:anchor.y+(nextFloat(rng)-.5)*520};if(distance(p,geometry.entry)>650&&!walls.some(w=>circleIntersectsRect(p.x,p.y,spec.attrs.radius+8,w))&&occupied.every(o=>distance(p,o.pos)>spec.attrs.radius+o.radius+20)){pos=p;break}}}
      occupied.push({pos,radius:spec.attrs.radius});return { ...spec, pos, rewardMultiplier: 1 }
    })
    const scale = finite(1.13 ** (floor - 1))
    const pickups = createRoomPickups(rng, geometry).map((pickup) => ({ ...pickup, value: pickup.kind === 'shard' ? finite(pickup.value * scale) : pickup.value }))
    applyRoom(world, { ...geometry, spawns, pickups })
    if (floor % 5 === 0) world.room.exit = exitForRoom(world, true)
  }
  const advance = (world: World) => { floor += 1; enter(world) }
  return {floor:()=>floor, room, initialize: (world) => { seed = world.seed; floor = 1; enter(world) }, advance,
    checkpoint: () => ({ floor, rngState: rng.state, respawned, spawnQueue: [...queue] }),
    restore: (world, saved) => { seed = world.seed; currentEntry = world.room.entry; currentPatrol = world.room.design?.patrol ?? []; floor = saved.floor; rng = createRng(saved.rngState); respawned = saved.respawned; queue = [...saved.spawnQueue]; population = Math.ceil(endlessCount(floor)*(world.coop ? 1+0.7*(world.coop.roomPartySize-1):1)) },
    afterStep: (world) => {
      if (world.gameOver) return
      if (world.exitReached) { advance(world); return }
      const open = floor % 5 === 0
      for (const [id, actor] of world.actors) if (actor.team === 'enemy' && !actor.alive) {
        world.actors.delete(id)
        if (open && !actor.spider && actor.behavior!=='relay') queue.push(world.tick + ENDLESS_RULES.respawnTicks)
      }
      if (!open) return
      const due = queue.filter((tick) => tick <= world.tick); queue = queue.filter((tick) => tick > world.tick)
      for (let i = 0; i < due.length; i++) {
        const encounter=world.room.design?.encounter as EncounterId|undefined
        const allowed=['drifter','turret','stalker','bomber','arc-rider','charger','bulwark','lancer','warden']
        let type=encounter?encounterEnemy(encounter,respawned,allowed):undefined
        if(type==='charger'&&[...world.actors.values()].filter(a=>a.alive&&a.behavior==='charger').length>=2)type='drifter'
        const spec = rollEndlessEnemy(floor, rng, true,type)
        respawned += 1
        const players=[...world.actors.values()].filter(a=>a.alive&&a.team==='player').map(a=>a.pos),occupied=[...world.actors.values()].filter(a=>a.alive).map(a=>({pos:a.pos,radius:a.radius}))
        spawnEnemy(world, { ...spec, pos: freePosition(world.room.walls,spec.attrs.radius,players.length?players:[getPlayer(world).pos],occupied), rewardMultiplier: endlessReward(respawned, population) })
      }
      world.room.exit = exitForRoom(world, true); world.roomCleared = false
      if (world.room.phase !== 'entered') world.room.phase = 'combat'
    },
    state: (world) => ({ seed, floor, open: floor % 5 === 0, initialCount: population-(world.room.design?.id==='relay-station'?2:0),
      alive: [...world.actors.values()].filter((actor) => actor.team === 'enemy' && actor.alive && actor.behavior!=='relay').length,
      pending: world.pendingSpawns.filter(s=>s.behavior!=='relay').length + queue.length, respawned, nextReward: endlessReward(respawned + 1, population),
      rngState: rng.state, spawnQueue: [...queue] }),
  }
}
