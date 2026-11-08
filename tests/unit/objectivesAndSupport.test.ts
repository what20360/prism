import {describe,it,expect} from 'vitest'
import {buildDungeon} from '../../src/content/dungeon'
import {ENEMIES} from '../../src/content/enemies'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {DEFAULT_ECONOMY} from '../../src/content/economy'
import {CARD_REGISTRY} from '../../src/content/cards'
import {createActor,createWorld,getPlayer,type World,type RoomTemplate} from '../../src/core/world'
import {updateObjectives,updateHazards,OBJECTIVE_RULES} from '../../src/core/systems/objectives'
import {updateAi} from '../../src/core/systems/ai'
import {updateRoom} from '../../src/core/systems/room'
import {applyDamage} from '../../src/core/systems/damage'
import {serializeWorld,restoreWorld} from '../../src/core/serialization'
import {circleIntersectsRect} from '../../src/core/collision'
import {findPath} from '../../src/core/navigation'
import {toSnapshot} from '../../src/core/snapshot'
import {createSyncEncoder,createSyncDecoder} from '../../src/net/sync'
import {createCoopMatch,DEFAULT_COOP,readCoopSave} from '../../src/app/modes/coop'
import {createEndlessMode} from '../../src/app/modes/endless'
const room:RoomTemplate={id:'test',kind:'combat',bounds:{x:0,y:0,width:3200,height:1800},walls:[],entry:{x:1000,y:800},spawns:[],pickups:[]}
const newWorld=(r:RoomTemplate=room)=>createWorld({seed:9,room:r,economy:DEFAULT_ECONOMY,registry:CARD_REGISTRY,playerAttrs:{...PLAYER_BASE_ATTRS,lifesteal:1,bloodOrbChance:10,mineShardChance:10}})
const restore=(w:World)=>restoreWorld(serializeWorld(w,true),CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS))
const hit=(w:World,id:number,n=1000)=>applyDamage(w,{sourceId:getPlayer(w).id,sourceTeam:'player',targetId:id,raw:n,penetration:0,isCore:false})
const spec={...ENEMIES.drifter!,pos:{x:500,y:350}}

describe('objective rooms',()=>{
 it('builds connected seeded objectives with safe spawn positions and finite gate budgets',()=>{
  const seen=new Set<string>()
  for(let seed=0;seed<15;seed++)for(const r of buildDungeon({seed,difficulty:4})){
   const o=r.objective;if(!o)continue;seen.add(o.kind)
   for(const n of o.nodes){expect(r.walls.some(w=>circleIntersectsRect(n.x,n.y,64,w))).toBe(false);expect(findPath(r,r.entry,n,34).length).toBeGreaterThan(0)}
   for(const e of o.spawns)for(const x of o.kind==='gate'?[e.pos.x,3200-e.pos.x]:[e.pos.x])expect(r.walls.some(w=>circleIntersectsRect(x,e.pos.y,e.attrs.radius,w))).toBe(false)
   expect(o.spawns.length).toBeGreaterThan(0);expect(o.reward).toBeLessThanOrEqual(625)
  }
  expect(seen).toEqual(new Set(['gate','mine']))
 })
 it('requires a single route, saves the countdown and opens only after reinforcement dies',()=>{
  const w=newWorld({...room,objective:{kind:'gate',nodes:[{x:1000,y:800},{x:2400,y:800}],spawns:[spec],reward:0}});w.room.phase='combat';updateRoom(w);expect(w.roomCleared).toBe(false)
  updateObjectives(w);expect(w.room.objective?.phase).toBe('warning');for(let i=0;i<30;i++)updateObjectives(w)
  const copy=restore(w);for(let i=0;i<60;i++){updateObjectives(w);updateObjectives(copy)}
  expect(w.room.objective?.phase).toBe('engaged');expect(copy.room.objective).toEqual(w.room.objective)
  for(const id of w.room.objective!.targets)w.actors.get(id)!.alive=false
  updateObjectives(w);updateRoom(w);expect(w.roomCleared).toBe(true);expect(w.room.exit).not.toBeNull()
 })
 it('makes the mine optional and pays the challenge reward only once across saves',()=>{
  const w=newWorld({...room,objective:{kind:'mine',nodes:[{x:1000,y:800}],spawns:[spec],reward:25}});w.room.phase='combat';updateRoom(w);expect(w.room.exit).not.toBeNull()
  for(let i=0;i<OBJECTIVE_RULES.holdTicks;i++)updateObjectives(w)
  expect(w.room.objective?.phase).toBe('warning');expect(w.room.exit).toBeNull()
  let copy=restore(w);for(let i=0;i<OBJECTIVE_RULES.warningTicks;i++)updateObjectives(copy)
  for(const id of copy.room.objective!.targets)copy.actors.get(id)!.alive=false
  updateObjectives(copy);expect(copy.room.objective?.claimed).toBe(true);expect(copy.pickups.reduce((n,p)=>n+p.value*(p.quantity??1),0)).toBe(25)
  copy=restore(copy);for(let i=0;i<10;i++)updateObjectives(copy);expect(copy.pickups.reduce((n,p)=>n+p.value*(p.quantity??1),0)).toBe(25)
 })
 it('allows a connected teammate to trigger and restores a cooperative countdown',()=>{
  const m=createCoopMatch({...DEFAULT_COOP,pauseOnDisconnect:false}),id=m.join('队员');m.ready(id);m.start();const w=m.world(),p=w.actors.get(id)!
  w.room.phase='combat';w.room.objective={kind:'gate',nodes:[{x:800,y:800},{x:2400,y:800}],spawns:[spec],reward:0,phase:'await',timer:0,hold:0,holder:null,selected:0,targets:[],claimed:false};w.room.walls=[];p.pos={x:2400,y:800};updateObjectives(w)
  expect(w.room.objective.selected).toBe(1);expect(w.room.objective.phase).toBe('warning')
  const save=readCoopSave(JSON.stringify(m.save())),loaded=createCoopMatch(save.config,save);expect(loaded.world().room.objective).toEqual(w.room.objective)
 })
 it('never places an objective on an endless open floor',()=>{
  for(let seed=0;seed<15;seed++){const mode=createEndlessMode(),w=createWorld({seed,room:mode.room(),registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS});mode.initialize(w);for(let i=1;i<5;i++)mode.advance(w);expect(w.room.objective).toBeUndefined();expect(w.room.exit).toBeTruthy()}
 })
})
describe('support enemy counterplay',()=>{
 it('warns before creating a zone, can be interrupted by effective damage, and expires',()=>{
  const w=newWorld(),a=createActor(w,{...ENEMIES.blocker!,team:'enemy',pos:{x:1300,y:800}});updateAi(w);expect(a.blocker?.phase).toBe('windup');expect(toSnapshot(w).actors.find(x=>x.id===a.id)?.supportWarning?.kind).toBe('blocker')
  hit(w,a.id,1);expect(a.blocker?.phase).toBe('cooldown');expect(w.hazards??[]).toHaveLength(0)
  a.blocker=undefined;updateAi(w);for(let i=0;i<60;i++)updateAi(w);expect(w.hazards).toHaveLength(1)
  const p=getPlayer(w);p.pos={x:2600,y:1400};const hp=p.hp;for(let i=0;i<180;i++)updateHazards(w);expect(w.hazards).toHaveLength(0);expect(p.hp).toBe(hp)
 })
 it('summons at most twice without income, drops, healing or kill credit',()=>{
  const w=newWorld(),p=getPlayer(w),a=createActor(w,{...ENEMIES.summoner!,team:'enemy',pos:{x:1300,y:800}});p.hp=10
  updateAi(w);for(let i=0;i<60;i++)updateAi(w);let children=[...w.actors.values()].filter(x=>x.summoned);expect(children).toHaveLength(1)
  const before={shards:w.shards,score:w.score,kills:w.stats.kills,pickups:w.pickups.length};hit(w,children[0]!.id);expect(p.hp).toBe(10);expect({shards:w.shards,score:w.score,kills:w.stats.kills,pickups:w.pickups.length}).toEqual(before)
  for(let i=0;i<301;i++)updateAi(w);children=[...w.actors.values()].filter(x=>x.summoned);expect(children).toHaveLength(2);expect(a.summoner?.charges).toBe(0)
  for(let i=0;i<1000;i++)updateAi(w);expect([...w.actors.values()].filter(x=>x.summoned)).toHaveLength(2)
  expect(restore(w).actors.get(a.id)?.summoner).toEqual(a.summoner)
 })
 it('preserves warnings, hazard and objectives through the network frame and delta',()=>{
  const w=newWorld({...room,objective:{kind:'gate',nodes:[{x:1000,y:800},{x:2400,y:800}],spawns:[spec],reward:0}}),a=createActor(w,{...ENEMIES.blocker!,team:'enemy',pos:{x:1300,y:800}});w.room.phase='combat';updateAi(w);updateObjectives(w)
  const enc=createSyncEncoder(),dec=createSyncDecoder(),state={waiting:false,startCountdown:0,snapshot:toSnapshot(w),attrs:getPlayer(w).attrs,purchases:[],plan:{enabled:false,targets:[]},notice:null,knownSkills:[],paused:false,label:'test',mode:'dungeon' as const}
  let view=dec.apply(JSON.parse(JSON.stringify(enc.encode(state,0))))!;expect(view.snapshot.objective?.phase).toBe('warning');expect(view.snapshot.actors.find(v=>v.id===a.id)?.supportWarning?.kind).toBe('blocker')
  for(let i=0;i<60;i++)updateAi(w);view=dec.apply(JSON.parse(JSON.stringify(enc.encode({...state,snapshot:toSnapshot(w)},100))))!;expect(view.snapshot.hazards).toHaveLength(1);expect(view.snapshot.actors.find(v=>v.id===a.id)?.supportWarning).toBeFalsy()
 })
})
