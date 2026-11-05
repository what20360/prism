import { describe,it,expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { createCoopMatch,DEFAULT_COOP } from '../../src/app/modes/coop'
import { createSyncEncoder,createSyncDecoder,createSnapshotInterpolator } from '../../src/net/sync'
import { playState,createRoom,joinRoom } from '../../src/server/rooms'
import { emitProjectile } from '../../src/core/systems/weapons'
import { updateProjectiles } from '../../src/core/systems/projectiles'
import { toSnapshot } from '../../src/core/snapshot'
import { DEFAULT_COOP as CONFIG } from '../../src/app/modes/coop'
import type { Identity } from '../../src/server/store'
const user:Identity={id:'owner',hash:'unused',name:'房主',created:0}
function setup(){const r=createRoom(user,{name:'测试',mode:'dungeon',duelMode:'budget',coop:CONFIG,hidden:false,password:''},0);for(let i=1;i<5;i++)joinRoom(r,{...user,id:'player'+i,name:'队员'+i},'');for(const m of r.members)r.coop!.ready(m.actorId,true);r.coop!.start();return r}
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
describe('display-only state replication',()=>{
 it('round trips private state, nullable mine fuses, energy traces and actors without leaking World internals',()=>{
  const room=setup(),w=room.coop!.world(),owner=w.actors.get(1)!;w.participants![1]!.shards=9.9999;owner.attrs.fireRate=.000001
  w.mines.push({id:w.nextEntityId++,team:'player',ownerId:1,pos:{...owner.pos},bodyRadius:30,triggerRadius:120,blastRadius:200,slowRadius:120,slowMultiplier:2,damage:30,hp:10,fuseTicks:null})
  const state=playState(room,'owner'),frame=createSyncEncoder().encode(state,0),decoded=createSyncDecoder().apply(wire(frame))!
  expect(decoded.snapshot.mines[0]!.fuseTicks).toBeNull();expect(decoded.snapshot.actors[0]!.bombTicks).toBeNull();expect(decoded.snapshot.actors[0]!.name).toBe('房主')
  expect(decoded.snapshot.shards).toBe(9.9999);expect(decoded.attrs.fireRate).toBe(.000001)
  expect(decoded.purchases).toEqual(state.purchases);expect(JSON.stringify(frame)).not.toContain('pendingSpawns');expect(JSON.stringify(frame)).not.toContain('hitIds');expect(JSON.stringify(frame)).not.toContain('basePlayerAttrs')
  expect(decoded.snapshot.projectiles).toEqual([])
 })
 it('applies changed fields, spawns and removals and recovers from gaps with a fresh keyframe',()=>{
  const room=setup(),encoder=createSyncEncoder(),decoder=createSyncDecoder(),w=room.coop!.world(),p=w.actors.get(1)!
  decoder.apply(wire(encoder.encode(playState(room,'owner'),0)))
  emitProjectile(w,p,0);p.hp=35.125;p.pos={x:p.pos.x+10.125,y:p.pos.y};w.tick++
  const delta=wire(encoder.encode(playState(room,'owner'),100));expect(delta.key).toBe(false);expect(delta.meta).not.toHaveProperty('walls')
  const next=decoder.apply(delta)!;expect(next.snapshot.actors[0]!.hp).toBe(35.125);expect(next.snapshot.projectiles).toHaveLength(1)
  expect(decoder.apply(delta)).toBeNull();encoder.encode(playState(room,'owner'),200)
  expect(()=>decoder.apply(encoder.encode(playState(room,'owner'),300))).toThrow('重新同步')
  w.projectiles=[];encoder.reset();expect(decoder.apply(wire(encoder.encode(playState(room,'owner'),400)))!.snapshot.projectiles).toHaveLength(0)
  expect(encoder.encode(playState(room,'owner'),5500).key).toBe(true)
 })
 it('does not modify authoritative state or share decoder baselines across clients',()=>{
  const room=setup(),a=createSyncEncoder(),b=createSyncEncoder(),one=createSyncDecoder(),two=createSyncDecoder(),w=room.coop!.world(),before=JSON.stringify(room.coop!.save().world)
  const fa=a.encode(playState(room,'owner'),0),fb=b.encode(playState(room,'player1'),0)
  expect(one.apply(wire(fa))!.snapshot.actors[0]!.id).toBe(1);expect(two.apply(wire(fb))!.snapshot.actors[0]!.id).toBe(room.members.find(m=>m.userId==='player1')!.actorId)
  expect(JSON.stringify(room.coop!.save().world)).toBe(before);expect(w.actors.get(1)!.pos).toEqual(room.coop!.save().world.actors.find(a=>a.id===1)!.pos)
 })
 it('smooths angles through the wrap boundary, rebuilds curved trails and snaps on room changes',()=>{
  const room=setup(),w=room.coop!.world(),p=w.actors.get(1)!,i=createSnapshotInterpolator();emitProjectile(w,p,0);p.aimAngle=3.1
  const a=toSnapshot(w,1);i.push(a,0);p.pos={x:p.pos.x+60,y:p.pos.y};p.aimAngle=-3.1;w.tick+=6;w.projectiles[0]!.pos={x:w.projectiles[0]!.pos.x+70,y:w.projectiles[0]!.pos.y};i.push(toSnapshot(w,1),100)
  const mid=i.read(150)!;expect(mid.actors[0]!.x).toBeCloseTo(a.actors[0]!.x+30);expect(Math.abs(mid.actors[0]!.aimAngle)).toBeCloseTo(Math.PI)
  i.read(170);expect(i.read(190)!.projectiles[0]!.trail.length).toBeGreaterThan(1)
  w.tick=0;i.push(toSnapshot(w,1),200);expect(i.read(200)!.actors[0]!.x).toBe(p.pos.x)
 })
 it('reduces a five-player 500-projectile message stream substantially at the same 10Hz cadence',()=>{
  const room=setup(),w=room.coop!.world(),p=w.actors.get(1)!;Object.assign(w.room,{bounds:{x:0,y:0,width:100000,height:100000},walls:[]});p.pos={x:50000,y:50000};p.attrs={...p.attrs,range:100000};for(let n=0;n<500;n++)emitProjectile(w,p,n*.01)
  const e=createSyncEncoder(),d=createSyncDecoder();let legacyBytes=0,packedBytes=0,compressedBytes=0
  for(let n=0;n<10;n++){w.tick+=6;updateProjectiles(w,.1);const old=JSON.stringify(room.coop!.save(2)),frame=JSON.stringify(e.encode(playState(room,'player1'),n*100));legacyBytes+=Buffer.byteLength(old);packedBytes+=Buffer.byteLength(frame);compressedBytes+=deflateRawSync(frame,{level:3}).length;expect(d.apply(JSON.parse(frame))).not.toBeNull()}
  expect(packedBytes/legacyBytes).toBeLessThan(.35);expect(compressedBytes/legacyBytes).toBeLessThan(.12)
 })
 it('keeps cooperative menu time from advancing autobuy and requires the auto-aim upgrade',()=>{
  const m=createCoopMatch({...DEFAULT_COOP,pauseOnDisconnect:false});m.start();m.action(1,{kind:'queue',id:'gun-damage'});m.action(1,{kind:'auto',enabled:true});m.showOffers(1,false)
  for(let n=0;n<240;n++)m.tick(new Map([[1,{move:{x:0,y:0},fire:false,autoAim:true}]]))
  expect(m.world().participants![1]!.purchases).toEqual([]);expect(m.world().actors.get(1)!.intent.autoAim).toBe(false)
 })
})
