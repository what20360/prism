import { describe,it,expect } from 'vitest'
import {createCoopMatch,DEFAULT_COOP,readCoopSave,coopPopulation} from '../../src/app/modes/coop'
import {applyDamage} from '../../src/core/systems/damage'
import {createActor} from '../../src/core/world'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {resourceWeights,grantCoopShards} from '../../src/core/coop'
import {updatePickups} from '../../src/core/systems/pickups'
import {encodeCoop,decodeCoop} from '../../src/net/coopProtocol'
import {toSnapshot} from '../../src/core/snapshot'
import {hashWorld} from '../../src/core/hash'
function party(count=2){const m=createCoopMatch({...DEFAULT_COOP,pauseOnDisconnect:false});const ids=[m.hostId()];for(let i=1;i<count;i++)ids.push(m.join('队员'+i));ids.forEach(id=>m.ready(id));expect(m.start()).toBe(true);return {m,w:m.world(),ids}}
const idle={move:{x:0,y:0},fire:false}
function kill(w:ReturnType<typeof party>['w'],id:number){w.actors.get(id)!.iframesTicks=0;applyDamage(w,{targetId:id,sourceId:999,sourceTeam:'enemy',raw:1e6,penetration:1e6,isCore:false})}
describe('cooperative campaign and endless authority',()=>{
 it.each([1,2,3,4,5])('starts %i friendly participants with independent starting money and valid snapshots',count=>{
  const {m,w,ids}=party(count);expect(w.coop!.members).toHaveLength(count);expect(ids.every(id=>w.actors.get(id)!.team==='player')).toBe(true)
  expect(ids.every(id=>w.participants![id]!.shards===200)).toBe(true);expect(coopPopulation(count)).toBeCloseTo(1+0.7*(count-1))
  const saved=readCoopSave(JSON.stringify(m.save()));expect(saved.world.coop!.members).toHaveLength(count)
  for(const id of ids)expect(toSnapshot(w,id).actors[0]!.id).toBe(id)
 })
 it('rejects a sixth player and seats cannot be claimed twice',()=>{const {m,ids}=party(5);expect(()=>m.join('第六人')).toThrow();expect(()=>m.join('冒名',ids[1])).toThrow()})
 it('requires initial ready check and prevents guests from buying through another wallet',()=>{
  const m=createCoopMatch();const id=m.join('队员');expect(m.start()).toBe(false);m.ready(id);expect(m.start()).toBe(true)
  expect(m.action(id,{kind:'buy',id:'gun-damage'})).toBe(true);expect(m.world().participants![id]!.shards).toBe(190);expect(m.world().participants![1]!.shards).toBe(200)
  expect(m.action(999,{kind:'buy',id:'gun-damage'})).toBe(false)
 })
 it('revives a downed player after five seconds at half health with no shield',()=>{
  const {m,w,ids}=party();const a=w.actors.get(ids[1]!)!;a.attrs={...a.attrs,shield:40};a.shield=40;kill(w,a.id);expect(a.alive).toBe(false);expect(w.gameOver).toBe(false)
  for(let i=0;i<299;i++)m.tick(new Map(ids.map(id=>[id,idle])));expect(a.alive).toBe(false);m.tick(new Map(ids.map(id=>[id,idle])));expect(a.alive).toBe(true);expect(a.hp).toBe(25);expect(a.shield).toBe(0);expect(a.iframesTicks).toBeGreaterThan(0)
 })
 it('preserves earned shields between rooms and revives fractional-health builds at exactly half',()=>{
  const {m,w,ids}=party();m.action(ids[1]!,{kind:'buy',id:'shield'});const b=w.actors.get(ids[1]!)!;b.shield=45;w.exitReached=true;m.tick(new Map());expect(b.shield).toBe(45)
  b.attrs={...b.attrs,maxHp:1.5};b.hp=1.5;kill(w,b.id);for(let i=0;i<300;i++)m.tick(new Map());expect(b.hp).toBe(0.75);expect(b.shield).toBe(0)
 })
 it('declares a wipe immediately without waiting for the revive countdown',()=>{const {m,w,ids}=party();ids.forEach(id=>kill(w,id));m.tick(new Map());expect(w.gameOver).toBe(true);expect(ids.every(id=>!w.actors.get(id)!.alive)).toBe(true)})
 it('offline players cannot keep the team alive or supply input and reconnect retains their build',()=>{
  const {m,w,ids}=party();m.action(ids[1]!,{kind:'buy',id:'gun-damage'});m.disconnect(ids[1]!);expect(w.coop!.members[1]!.connected).toBe(false)
  m.join('',ids[1]);expect(w.actors.get(ids[1]!)!.attrs.damage).toBe(12);m.disconnect(ids[1]!);kill(w,ids[0]!);m.tick(new Map());expect(w.gameOver).toBe(true)
 })
 it('cannot rescue an active wipe by pausing on the last living teammate disconnect',()=>{
  const m=createCoopMatch(DEFAULT_COOP),id=m.join('队员');m.ready(id);m.start();kill(m.world(),1);m.disconnect(id)
  expect(m.world().paused).toBe(true);expect(m.world().gameOver).toBe(true);m.join('新人');expect(m.start()).toBe(false)
 })
 it('scales the next room population once and transitions the complete party',()=>{
  const {m,w,ids}=party(5);w.exitReached=true;m.tick(new Map(ids.map(id=>[id,idle])));expect(m.roomIndex()).toBe(1);expect(w.pendingSpawns.length).toBeGreaterThan(10)
  expect(w.coop!.roomPartySize).toBe(5);const count=w.pendingSpawns.length;m.disconnect(ids[4]!);expect(w.pendingSpawns).toHaveLength(count)
  expect(ids.every(id=>Math.hypot(w.actors.get(id)!.pos.x-w.room.entry.x,w.actors.get(id)!.pos.y-w.room.entry.y)<80)).toBe(true)
 })
 it('lets a surviving non-host activate rooms and opens the team exit',()=>{
  const {m,w,ids}=party();w.exitReached=true;m.tick(new Map());kill(w,ids[0]!);w.actors.get(ids[1]!)!.pos={x:1600,y:1100};m.tick(new Map([[ids[1]!,idle]]));expect(w.pendingSpawns).toHaveLength(0);expect(w.room.phase).toBe('combat')
 })
 it.each(['equal','killer','free','damage'] as const)('preserves base crystal totals in %s resource mode',mode=>{
  const {w,ids}=party(3);w.coop!.resourceMode=mode;const before=ids.map(id=>w.participants![id]!.shards)
  grantCoopShards(w,120,ids[1]!,{[ids[0]!]:30,[ids[1]!]:90})
  expect(ids.reduce((s,id,i)=>s+w.participants![id]!.shards-before[i]!,0)).toBeCloseTo(120)
  if(mode==='equal')expect(w.participants![ids[2]!]!.shards).toBe(240)
  if(mode==='damage'){const weights=resourceWeights(w,ids[1],{[ids[0]!]:30,[ids[1]!]:90});expect(weights[1]![1]).toBeGreaterThan(weights[0]![1]);expect(weights[2]![1]).toBeGreaterThan(0)}
 })
 it('shares health without wasting it on full-health or downed members',()=>{
  const {w,ids}=party(3);const a=w.actors.get(ids[0]!)!,b=w.actors.get(ids[1]!)!,c=w.actors.get(ids[2]!)!
  a.pos={x:500,y:500};b.pos={x:1000,y:1000};b.hp=30;c.pos={x:1500,y:1000};c.hp=45
  w.pickups=[{id:w.nextEntityId++,kind:'blood',pos:{...a.pos},value:25,ttl:1800}];updatePickups(w)
  expect(w.pickups).toHaveLength(0);expect(b.hp).toBe(50);expect(c.hp).toBe(50);expect(a.hp).toBe(50)
  w.pickups=[{id:w.nextEntityId++,kind:'blood',pos:{...a.pos},value:1,ttl:1800}];updatePickups(w);expect(w.pickups).toHaveLength(1)
 })
 it('locks kill drops to their owner until that owner disconnects',()=>{
  const {m,w,ids}=party();w.coop!.resourceMode='killer';const a=w.actors.get(ids[0]!)!,b=w.actors.get(ids[1]!)!;b.pos={x:a.pos.x+300,y:a.pos.y}
  w.pickups=[{id:w.nextEntityId++,kind:'shard',pos:{...a.pos},value:25,ttl:1800,ownerId:b.id}];updatePickups(w);expect(w.pickups).toHaveLength(1)
  m.disconnect(b.id);updatePickups(w);expect(w.pickups).toHaveLength(0);expect(w.participants![a.id]!.shards).toBe(225)
 })
 it('records effective damage contributions without friendly hits or overkill inflation',()=>{
  const {w,ids}=party();w.pickups=[];const e=createActor(w,{team:'enemy',tier:'normal',behavior:'turret',hasCore:false,contactDamage:0,pos:{x:600,y:300},attrs:{...PLAYER_BASE_ATTRS,maxHp:100}})
  for(const [source,raw]of [[ids[0]!,25],[ids[1]!,500]] as const)applyDamage(w,{targetId:e.id,sourceId:source,sourceTeam:'player',raw,penetration:0,isCore:false})
  expect(e.contributions).toEqual({[ids[0]!]:25,[ids[1]!]:75});expect(w.pickups.every(p=>p.ownerId===ids[1])).toBe(true)
 })
 it('keeps health-reducing builds and a non-original host valid through export and resume',()=>{
  const {m,w,ids}=party();expect(m.action(ids[1]!,{kind:'buy',id:'glass-cannon'})).toBe(true)
  const save=readCoopSave(JSON.stringify(m.save(ids[1]))),loaded=createCoopMatch(save.config,save)
  expect(loaded.hostId()).toBe(ids[1]);expect(loaded.world().coop!.members[0]!.connected).toBe(false)
  expect(loaded.world().actors.get(ids[1]!)!.hp).toBe(w.actors.get(ids[1]!)!.hp)
  expect(loaded.world().actors.get(ids[1]!)!.attrs.maxHp).toBe(35)
  save.roomIndex=25;expect(()=>readCoopSave(JSON.stringify(save))).toThrow()
 })
 it('loads absent participants as disconnected while preserving countdown and purchases',()=>{
  const {m,w,ids}=party();m.action(ids[1]!,{kind:'buy',id:'gun-damage'});kill(w,ids[1]!);for(let i=0;i<100;i++)m.tick(new Map())
  const save=readCoopSave(JSON.stringify(m.save())),loaded=createCoopMatch(save.config,save);expect(loaded.world().paused).toBe(true)
  const member=loaded.world().coop!.members[1]!;expect(member.connected).toBe(false);expect(member.reviveTicks).toBe(200);loaded.join('',member.id);expect(loaded.world().actors.get(member.id)!.attrs.damage).toBe(12)
 })
 it('replays five-client inputs deterministically through save/network validation',()=>{
  const a=party(5),saved=readCoopSave(JSON.stringify(a.m.save())),b=createCoopMatch(saved.config,saved);for(const id of a.ids.slice(1))b.join('',id);b.start()
  // Reconnection intentionally removes shields and grants spawn protection; align both worlds before comparison.
  for(const id of a.ids){a.w.actors.get(id)!.iframesTicks=120;b.world().actors.get(id)!.iframesTicks=120;a.w.coop!.members.find(m=>m.id===id)!.ready=b.world().coop!.members.find(m=>m.id===id)!.ready}
  for(let i=0;i<30;i++){const inputs=new Map(a.ids.map((id,n)=>[id,{move:{x:n%2?1:0,y:0},fire:false}]));a.m.tick(inputs);b.tick(inputs)}
  expect(hashWorld(a.w)).toBe(hashWorld(b.world()))
  const packet=decodeCoop(encodeCoop({type:'state',serial:1,viewerId:a.ids[4]!,save:a.m.save(a.ids[4])}));expect(packet.type).toBe('state')
 })
 it('validates packet boundaries, unknown actions and corrupt imported party states',()=>{
  expect(()=>decodeCoop('{"protocol":"wrong"}')).toThrow();expect(()=>decodeCoop(encodeCoop({type:'action',sequence:1,action:{kind:'buy',id:'missing'}}))).toThrow()
  const {m}=party();const save=m.save();save.world.coop!.members[1]!.id=save.hostId;expect(()=>readCoopSave(JSON.stringify(save))).toThrow()
 })
 it('restarts the whole party with stable seats and fresh wallets, requiring readiness again',()=>{
  const {m,w,ids}=party(5);m.action(ids[2]!,{kind:'buy',id:'gun-damage'});m.disconnect(ids[4]!);kill(w,ids[1]!);m.restart()
  const fresh=m.world();expect(fresh).not.toBe(w);expect(fresh.coop!.members.map(p=>p.id)).toEqual(ids);expect(fresh.coop!.members[4]!.connected).toBe(false)
  expect(fresh.participants![ids[2]!]!.shards).toBe(200);expect(fresh.participants![ids[2]!]!.purchases).toEqual([]);expect(fresh.coop!.members[1]!.reviveTicks).toBe(0)
  expect(m.start()).toBe(false);ids.slice(1,4).forEach(id=>m.ready(id));expect(m.start()).toBe(true);expect(new Set([...fresh.actors.keys()]).size).toBe(fresh.actors.size)
  expect(()=>readCoopSave(JSON.stringify(m.save()))).not.toThrow()
 })
 it('pauses countdowns and purchases while offline, and does not resume an ended run',()=>{
  const {m,w,ids}=party();kill(w,ids[1]!);m.pause();for(let i=0;i<60;i++)m.tick(new Map());expect(w.coop!.members[1]!.reviveTicks).toBe(300)
  m.disconnect(ids[1]!);expect(m.action(ids[1]!,{kind:'buy',id:'gun-damage'})).toBe(false);w.gameOver=true;expect(m.start()).toBe(false)
 })
 it('never applies friendly damage, and dead owners cannot heal from lingering bullets',()=>{
  const {w,ids}=party();const a=w.actors.get(ids[0]!)!,b=w.actors.get(ids[1]!)!;a.iframesTicks=0
  applyDamage(w,{targetId:a.id,sourceId:b.id,sourceTeam:'player',raw:1000,penetration:1000,isCore:false});expect(a.hp).toBe(50)
  b.attrs={...b.attrs,lifesteal:1};kill(w,b.id);const e=createActor(w,{team:'enemy',tier:'normal',behavior:'turret',hasCore:false,contactDamage:0,pos:{x:600,y:300},attrs:{...PLAYER_BASE_ATTRS,maxHp:100}})
  applyDamage(w,{targetId:e.id,sourceId:b.id,sourceTeam:'player',raw:10,penetration:0,isCore:false});expect(b.hp).toBe(0);expect(b.alive).toBe(false)
 })
 it('supports cooperative endless generation and preserves its random state on resume',()=>{
  const m=createCoopMatch({...DEFAULT_COOP,mode:'endless'});for(let i=0;i<4;i++)m.join('队员'+i);m.world().coop!.members.forEach(p=>m.ready(p.id));m.start();expect(m.world().pendingSpawns.length).toBe(23);m.world().exitReached=true;m.tick(new Map());expect(m.save().endless!.floor).toBe(2);expect(m.world().pendingSpawns.length).toBeGreaterThan(15)
  const save=readCoopSave(JSON.stringify(m.save())),loaded=createCoopMatch(save.config,save);expect(loaded.save().endless).toEqual(save.endless)
 })
})
