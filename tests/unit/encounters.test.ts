import {describe,it,expect} from 'vitest'
import {ENCOUNTERS,endlessEncounter} from '../../src/content/encounters'
import {buildDungeon} from '../../src/content/dungeon'
import {LEVEL_SETS} from '../../src/content/levelSets'
import {ENEMIES} from '../../src/content/enemies'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {DEFAULT_ECONOMY} from '../../src/content/economy'
import {CARD_REGISTRY} from '../../src/content/cards'
import {createActor,createWorld,getPlayer,type World} from '../../src/core/world'
import {circleIntersectsRect,distance} from '../../src/core/collision'
import {findPath,hasLineOfSight} from '../../src/core/navigation'
import {updateAi} from '../../src/core/systems/ai'
import {updateMovement} from '../../src/core/systems/movement'
import {updateRoom} from '../../src/core/systems/room'
import {applyDamage} from '../../src/core/systems/damage'
import {fireElectric,fireLaserPulse} from '../../src/core/systems/energyWeapons'
import {emitProjectile} from '../../src/core/systems/weapons'
import {updateProjectiles} from '../../src/core/systems/projectiles'
import {resolveHits} from '../../src/core/systems/hits'
import {tryPlaceMine,updateMines} from '../../src/core/systems/mines'
import {ENCOUNTER_RULES,relayAssignments,supportingRelay} from '../../src/core/systems/encounter'
import {serializeWorld,restoreWorld} from '../../src/core/serialization'
import {hashWorld} from '../../src/core/hash'
import {step} from '../../src/core/simulation'
import {toSnapshot} from '../../src/core/snapshot'
import {createSyncEncoder,createSyncDecoder} from '../../src/net/sync'
import {createEndlessMode,ENDLESS_RULES,endlessCount,endlessReward} from '../../src/app/modes/endless'
import {createCoopMatch,DEFAULT_COOP,readCoopSave} from '../../src/app/modes/coop'
const room={id:'test',kind:'combat' as const,bounds:{x:0,y:0,width:3200,height:1800},walls:[],entry:{x:1000,y:800},pickups:[],spawns:[]}
function world(seed=3){return createWorld({seed,room,economy:DEFAULT_ECONOMY,registry:CARD_REGISTRY,playerAttrs:{...PLAYER_BASE_ATTRS,lifesteal:1,mineShardChance:10,bloodOrbChance:10}})}
function enemy(w:World,id:keyof typeof ENEMIES,x:number,y:number){return createActor(w,{...ENEMIES[id]!,team:'enemy',pos:{x,y}})}
function hit(w:World,id:number,raw:number){applyDamage(w,{sourceId:getPlayer(w).id,sourceTeam:'player',targetId:id,raw,penetration:0,isCore:false})}
describe('authored encounter composition and geography',()=>{
 it('is reproducible, avoids the last two themes, keeps slots and supports all themes',()=>{
  const seen=new Set<string>()
  for(let seed=0;seed<12;seed++)for(const difficulty of [1,4,7] as const){
   const first=buildDungeon({seed,difficulty});expect(first).toEqual(buildDungeon({seed,difficulty}))
   const themed=first.filter(r=>r.design?.encounter)
   for(let i=0;i<themed.length;i++){
    const id=themed[i]!.design!.encounter!;seen.add(id);expect(themed.slice(Math.max(0,i-2),i).map(r=>r.design!.encounter)).not.toContain(id)
    for(const wave of [themed[i]!.spawns,...(themed[i]!.waves??[])])expect(wave.filter(s=>s.behavior==='charger').length).toBeLessThanOrEqual(2)
    if(themed[i]!.design!.id==='relay-station'){const test=createWorld({seed,room:themed[i]!,economy:DEFAULT_ECONOMY,registry:CARD_REGISTRY,playerAttrs:PLAYER_BASE_ATTRS});expect(relayAssignments(test).size).toBeGreaterThan(0)}
   }
  }
  expect(seen).toEqual(new Set(ENCOUNTERS.map(e=>e.id)))
  for(let floor=1;floor<30;floor++){expect(endlessEncounter(123,floor)).toBe(endlessEncounter(123,floor));if(floor>2)expect([endlessEncounter(123,floor-1),endlessEncounter(123,floor-2)]).not.toContain(endlessEncounter(123,floor))}
 })
 it('keeps all ordinary layouts connected for players and larger enemies',()=>{
  for(const level of LEVEL_SETS.filter(s=>s.kind==='combat')){
   const r=level.room(),exit={x:r.design!.exit.x+r.design!.exit.width/2,y:r.design!.exit.y+r.design!.exit.height/2}
   for(const radius of [34,46,64])for(const target of [exit,...r.design!.patrol]){
    expect(r.walls.some(w=>circleIntersectsRect(target.x,target.y,radius,w)),level.id).toBe(false)
    const path=findPath(r,r.entry,target,radius);expect(path.length,level.id).toBeGreaterThan(0)
    for(let i=0;i<path.length;i++)expect(hasLineOfSight(i?path[i-1]!:r.entry,path[i]!,r.walls,radius),level.id).toBe(true)
   }
  }
 })
 it('places two devices only on the first station wave and leaves them inside the original budget',()=>{
  let checked=0
  for(let seed=0;seed<15;seed++)for(const r of buildDungeon({seed,difficulty:4}).filter(r=>r.design?.id==='relay-station')){
   checked++;expect(r.spawns.filter(e=>e.behavior==='relay')).toHaveLength(2)
   for(const wave of r.waves??[])expect(wave.some(e=>e.behavior==='relay')).toBe(false)
   for(const s of [r.spawns,...(r.waves??[])].flat()){
    expect(r.walls.some(w=>circleIntersectsRect(s.pos.x,s.pos.y,s.attrs.radius,w))).toBe(false)
    expect(distance(s.pos,r.entry)).toBeGreaterThan(360)
   }
  }
  expect(checked).toBeGreaterThan(10)
 })
})
describe('relay counterplay and rewards',()=>{
 it('protects only two nearest allies with line of sight and reports the actual armor',()=>{
  const w=world(),r=enemy(w,'relay',1500,800),a=enemy(w,'drifter',1600,800),b=enemy(w,'drifter',1700,800),c=enemy(w,'drifter',1800,800)
  const links=relayAssignments(w);for(const actor of [r,a,b,c])expect(supportingRelay(w,actor)?.id).toBe(links.get(actor.id)?.id);expect(links.size).toBe(2);expect(links.get(a.id)?.id).toBe(r.id);expect(links.get(b.id)?.id).toBe(r.id);expect(links.has(c.id)).toBe(false)
  const view=toSnapshot(w).actors.find(x=>x.id===a.id)!;expect(view.supportRelayId).toBe(r.id);expect(view.armor).toBe(a.attrs.armor+ENCOUNTER_RULES.relayArmor)
  w.room.walls=[{x:1540,y:600,width:20,height:400}];expect(relayAssignments(w).size).toBe(0)
 })
 it('removes armor on destruction without shards, healing, kill chains or loot',()=>{
  const w=world(),p=getPlayer(w),r=enemy(w,'relay',1500,800),guard=enemy(w,'drifter',1650,800)
  p.hp=10;const before={shards:w.shards,score:w.score,kills:w.stats.kills,chain:w.stats.chain,pickups:w.pickups.length};hit(w,r.id,1e6)
  expect(r.alive).toBe(false);expect(p.hp).toBe(10);expect({shards:w.shards,score:w.score,kills:w.stats.kills,chain:w.stats.chain,pickups:w.pickups.length}).toEqual(before)
  expect(toSnapshot(w).actors.find(x=>x.id===guard.id)!.armor).toBe(guard.attrs.armor)
 })
 it('calculates real damage with relay armor, never buffs devices or stacks two relays',()=>{
  const w=world(),r=enemy(w,'relay',1500,800),r2=enemy(w,'relay',1510,800),guard=enemy(w,'drifter',1600,800)
  guard.attrs={...guard.attrs,armor:0,block:0,physicalResist:0,maxHp:1000};guard.hp=1000;hit(w,guard.id,100)
  expect(1000-guard.hp).toBeCloseTo(100/1.35);expect(relayAssignments(w).has(r.id)).toBe(false);expect(relayAssignments(w).has(r2.id)).toBe(false)
 })
 it.each(['bullet','electric','laser','mine'] as const)('%s can destroy a relay without earning resources',weapon=>{
  const w=world(),p=getPlayer(w),relay=enemy(w,'relay',1120,800);p.attrs={...p.attrs,damage:10000,range:1000,bulletSpeed:1000,mineDamage:10000,mineBlastRadius:250};p.aimAngle=0
  if(weapon==='electric')fireElectric(w,p,0)
  else if(weapon==='laser')fireLaserPulse(w,p,0)
  else if(weapon==='mine'){tryPlaceMine(w,p);w.mines[0]!.fuseTicks=1;updateMines(w)}
  else{emitProjectile(w,p,0);for(let tick=0;tick<20&&relay.alive;tick++){updateProjectiles(w,1/60);resolveHits(w)}}
  expect(relay.alive).toBe(false);expect(w.shards).toBe(0);expect(w.stats.kills).toBe(0);expect(w.pickups).toHaveLength(0)
 })
 it('does not block waves or clear: the devices persist between waves and shut down on the final clear',()=>{
  const wave={...ENEMIES.drifter!,pos:{x:1900,y:800}},w=createWorld({seed:1,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room:{...room,spawns:[{...ENEMIES.relay!,pos:{x:1400,y:800}},{...ENEMIES.drifter!,pos:{x:1700,y:800}}],waves:[[wave]]}})
  for(const a of w.actors.values())if(a.behavior==='chase')a.alive=false
  updateRoom(w);expect(w.waves!.countdown).toBe(90);expect([...w.actors.values()].some(a=>a.alive&&a.behavior==='relay')).toBe(true)
  for(let i=0;i<90;i++)updateRoom(w);expect(w.waves!.index).toBe(2)
  for(const a of w.actors.values())if(a.behavior==='chase')a.alive=false
  updateRoom(w);expect(w.roomCleared).toBe(true);expect(w.room.exit).toBeTruthy();expect([...w.actors.values()].some(a=>a.behavior==='relay')).toBe(false)
 })
})
describe('charger telegraph, collision and persistent state',()=>{
 it('locks aim for 0.9s, charges straight and has a recovery before its next attack',()=>{
  const w=world(),p=getPlayer(w),a=enemy(w,'charger',1300,800);updateAi(w);expect(a.charge).toMatchObject({phase:'windup',ticks:54});const angle=a.charge!.angle
  p.pos={x:1000,y:1000};for(let i=0;i<54;i++){updateAi(w);expect(a.charge!.angle).toBe(angle)}
  expect(a.charge!.phase).toBe('dash');const before={...a.pos};updateAi(w);updateMovement(w);expect(a.pos.x).toBeLessThan(before.x);expect(a.pos.y).toBeCloseTo(before.y)
  for(let i=0;i<24;i++){updateAi(w);updateMovement(w)}expect(a.charge!.phase).toBe('recovery')
  for(let i=0;i<36;i++)updateAi(w);expect(a.charge!.phase).toBe('cooldown')
 })
 it('cannot begin through a wall and stops instead of sliding along a wall',()=>{
  const w=world(),a=enemy(w,'charger',1300,800);w.room.walls=[{x:1150,y:600,width:20,height:400}];updateAi(w);expect(a.charge).toBeUndefined()
  w.room.walls=[];updateAi(w);expect(a.charge!.phase).toBe('windup');for(let i=0;i<54;i++)updateAi(w)
  w.room.walls=[{x:1200,y:600,width:20,height:400}]
  for(let i=0;i<30&&a.charge!.phase==='dash';i++){updateAi(w);updateMovement(w)}
  expect(a.charge!.phase).toBe('recovery');expect(a.pos.x-a.radius).toBeGreaterThanOrEqual(1220)
 })
 it('bounds charge distance even when the enemy has extreme speed',()=>{
  const w=world(),a=enemy(w,'charger',1400,800);a.attrs={...a.attrs,speed:100000};updateAi(w);for(let i=0;i<54;i++)updateAi(w)
  const start={...a.pos};for(let i=0;i<24;i++){updateAi(w);updateMovement(w)}expect(distance(a.pos,start)).toBeLessThanOrEqual(ENCOUNTER_RULES.chargeMax+1e-6)
 })
 it('continues deterministically after saving mid-warning and mid-charge, and rejects invalid states',()=>{
  const w=world(),a=enemy(w,'charger',1300,800);updateAi(w);for(let i=0;i<18;i++)updateAi(w)
  let copy=restoreWorld(serializeWorld(w,true),CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS))
  for(let i=0;i<42;i++){step(w,new Map());step(copy,new Map());expect(hashWorld(w)).toBe(hashWorld(copy))}
  copy=restoreWorld(serializeWorld(w,true),CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS));for(let i=0;i<30;i++){step(w,new Map());step(copy,new Map());expect(hashWorld(w)).toBe(hashWorld(copy))}
  const invalid=serializeWorld(w,true);(invalid.actors.find(x=>x.id===a.id)!.charge as {phase:string}).phase='invalid';expect(()=>restoreWorld(invalid,CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS))).toThrow()
 })
 it('syncs the locked warning direction and protected target links through a network delta',()=>{
  const w=world(),a=enemy(w,'charger',1300,800),r=enemy(w,'relay',1600,800),b=enemy(w,'drifter',1650,800);updateAi(w)
  const enc=createSyncEncoder(),dec=createSyncDecoder(),state={waiting:false,startCountdown:0,snapshot:toSnapshot(w),attrs:getPlayer(w).attrs,purchases:[],plan:{enabled:false,targets:[]},notice:null,knownSkills:[],paused:false,label:'test',mode:'dungeon' as const}
  const sync=dec.apply(JSON.parse(JSON.stringify(enc.encode(state,0))))!;expect(sync.snapshot.actors.find(v=>v.id===a.id)!.windupTicks).toBe(54);expect(sync.snapshot.actors.find(v=>v.id===b.id)!.supportRelayId).toBe(r.id)
  r.alive=false;const delta=dec.apply(JSON.parse(JSON.stringify(enc.encode({...state,snapshot:toSnapshot(w)},100))))!;expect(delta.snapshot.actors.find(v=>v.id===b.id)!.supportRelayId).toBeFalsy()
 })
})
describe('endless and cooperative encounter integration',()=>{
 function run(seed:number){const mode=createEndlessMode(),w=createWorld({seed,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room:mode.room()});mode.initialize(w);return {mode,w}}
 it('reuses deterministic theme and retains finite-floor stat limits at station',()=>{
  let found=0
  for(let seed=0;seed<80;seed++){const {mode,w}=run(seed);if(w.room.design?.id!=='relay-station')continue;found++
   expect(w.pendingSpawns).toHaveLength(endlessCount(1));expect(w.pendingSpawns.filter(s=>s.behavior==='relay')).toHaveLength(2);expect(mode.state(w).pending).toBe(endlessCount(1)-2);expect(mode.state(w).initialCount).toBe(endlessCount(1)-2)
   for(let i=0;i<w.pendingSpawns.length;i++)for(let j=i+1;j<w.pendingSpawns.length;j++)expect(distance(w.pendingSpawns[i]!.pos,w.pendingSpawns[j]!.pos)).toBeGreaterThanOrEqual(w.pendingSpawns[i]!.attrs.radius+w.pendingSpawns[j]!.attrs.radius)
   expect(w.room.design!.encounter).toBe(endlessEncounter(seed,1));const save=mode.checkpoint(),copy=restoreWorld(serializeWorld(w),CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS)),restored=createEndlessMode();restored.restore(copy,save)
   expect(restored.checkpoint()).toEqual(save);expect(hashWorld(copy)).toBe(hashWorld(w))
  }expect(found).toBeGreaterThan(0)
 })
 it('does not replenish a destroyed station device on open floors, while ordinary enemies still respawn with falling rewards',()=>{
  let chosen:ReturnType<typeof run>|undefined
  for(let seed=0;seed<150&&!chosen;seed++){const t=run(seed);for(let i=0;i<4;i++)t.mode.advance(t.w);if(t.w.room.design?.id==='relay-station')chosen=t}
  expect(chosen).toBeTruthy();const {mode,w}=chosen!;getPlayer(w).pos={x:1600,y:1200};step(w,new Map());mode.afterStep(w)
  const relay=[...w.actors.values()].find(a=>a.behavior==='relay')!,other=[...w.actors.values()].find(a=>a.team==='enemy'&&a.behavior!=='relay')!
  hit(w,relay.id,1e9);mode.afterStep(w);expect(mode.state(w).pending).toBe(0);expect(mode.state(w).respawned).toBe(0)
  other.alive=false;mode.afterStep(w);expect(mode.state(w).pending).toBe(1);w.tick+=ENDLESS_RULES.respawnTicks;mode.afterStep(w)
  expect(mode.state(w).respawned).toBe(1);expect([...w.actors.values()].at(-1)!.rewardMultiplier).toBeCloseTo(endlessReward(1,endlessCount(5)))
 })
 it('keeps devices out of player-count reinforcement and preserves a live encounter in a cooperative save',()=>{
  let seed=0;while(seed<100&&!buildDungeon({seed,difficulty:2}).some(r=>r.design?.id==='relay-station'))seed++
  const m=createCoopMatch({...DEFAULT_COOP,seed,difficulty:2,pauseOnDisconnect:false});const ids=[1,m.join('2'),m.join('3'),m.join('4'),m.join('5')];ids.slice(1).forEach(id=>m.ready(id));expect(m.start()).toBe(true)
  const station=buildDungeon({seed,difficulty:2}).findIndex(r=>r.design?.id==='relay-station')
  for(let i=0;i<station;i++){m.world().exitReached=true;m.tick(new Map(ids.map(id=>[id,{move:{x:0,y:0},fire:false}])))}
  const w=m.world();expect(w.room.design?.id).toBe('relay-station');expect(w.pendingSpawns.filter(x=>x.behavior==='relay')).toHaveLength(2);expect(w.pendingSpawns.length).toBeGreaterThan(buildDungeon({seed,difficulty:2})[station]!.spawns.length)
  for(let i=0;i<w.pendingSpawns.length;i++)for(let j=i+1;j<w.pendingSpawns.length;j++)expect(distance(w.pendingSpawns[i]!.pos,w.pendingSpawns[j]!.pos)).toBeGreaterThanOrEqual(w.pendingSpawns[i]!.attrs.radius+w.pendingSpawns[j]!.attrs.radius)
  for(const id of ids)w.actors.get(id)!.pos={x:1600,y:1300};m.tick(new Map(ids.map(id=>[id,{move:{x:0,y:0},fire:false}])))
  const device=[...w.actors.values()].find(a=>a.behavior==='relay')!;expect(device).toBeTruthy();hit(w,device.id,20);expect(device.hp).toBeLessThan(device.attrs.maxHp)
  const restored=readCoopSave(JSON.stringify(m.save()));expect(restored.world.actors.filter(x=>x.behavior==='relay')).toHaveLength(2);expect(restored.world.room.design?.encounter).toBe(w.room.design?.encounter)
  const loaded=createCoopMatch(restored.config,restored);expect(loaded.world().actors.get(device.id)!.hp).toBe(device.hp);expect(loaded.world().paused).toBe(true)
 })
})
