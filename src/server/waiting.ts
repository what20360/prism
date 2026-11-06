import { createActor, createWorld, type World } from '../core/world'
import { step } from '../core/simulation'
import { PLAYER_BASE_ATTRS } from '../content/player'
import type { Intent } from '../core/controller'
import { IDLE_INPUT } from '../net/control'

/** A disposable training world. Its RNG, resources, damage and cooldowns never enter the match. */
export function createWaitingArena(source: World) {
 const world=createWorld({seed:(source.seed^0x51a7ce)>>>0,registry:source.registry,economy:{tierRate:{normal:0,elite:0,boss:0},takenRate:0,overflowRate:0},playerAttrs:source.basePlayerAttrs,room:{id:'server-waiting',kind:'combat',bounds:{x:0,y:0,width:2000,height:1300},entry:{x:1000,y:1000},walls:[{x:520,y:620,width:160,height:80},{x:1320,y:620,width:160,height:80}],pickups:[],spawns:[]}})
 world.actors.clear();world.nextEntityId=Math.max(1000000,source.nextEntityId+1000);world.room.phase='combat';world.room.exit=null;world.resourceDrops=false
 const targets:number[]=[]
 for(const [index,armor] of [0,20,60].entries())targets.push(createActor(world,{team:'enemy',tier:'normal',behavior:'turret',contactDamage:0,hasCore:index===2,pos:{x:600+index*400,y:350},attrs:{...PLAYER_BASE_ATTRS,maxHp:100000,armor,speed:0,damage:0,fireRate:0,autoFire:0},name:`训练靶 · 护甲${armor}`}).id)
 const sync=(source:World,members:readonly {actorId:number;connected:boolean;name?:string}[])=>{
  const ids=new Set(members.map(m=>m.actorId));for(const [id,a]of world.actors)if(a.team==='player'&&!ids.has(id))world.actors.delete(id)
  world.participants={}
  for(const [index,m]of members.entries()){
   const original=source.actors.get(m.actorId)!,existing=world.actors.get(m.actorId),a=existing??{...structuredClone(original),team:'player' as const}
   if(!existing){a.pos={x:650+index*170,y:1000};a.intent=IDLE_INPUT;world.actors.set(a.id,a)}
   if(a.attrs.weapon!==original.attrs.weapon){a.electricBudget=0;a.electricTimer=0;a.laserTicks=0;a.laserTimer=0;a.burstRemaining=0}
   a.attrs={...original.attrs};a.radius=original.radius;a.skillSlots=[...original.skillSlots];a.alive=m.connected;a.hp=m.connected?a.attrs.maxHp:0;a.iframesTicks=2
   if(source.participants?.[m.actorId])world.participants[m.actorId]=structuredClone(source.participants[m.actorId]!)
  }
  world.coop={members:members.map(m=>({id:m.actorId,name:m.name??'玩家',connected:m.connected,ready:true,reviveTicks:0,offlineHp:world.actors.get(m.actorId)!.attrs.maxHp,offlineAlive:true})),resourceMode:'free',baseShare:0,maxPlayers:5,roomPartySize:Math.max(1,members.filter(m=>m.connected).length),pauseOnDisconnect:false}
  world.paused=false;world.gameOver=false;world.victory=false;world.pickups=[];world.exitReached=false
 }
 return {world,sync,tick:(source:World,members:readonly {actorId:number;connected:boolean;name?:string}[],inputs:ReadonlyMap<number,Intent>)=>{
  sync(source,members)
  const clean=new Map<number,Intent>();for(const m of members)if(m.connected){const a=world.actors.get(m.actorId)!,intent=inputs.get(m.actorId)??IDLE_INPUT;clean.set(m.actorId,{...intent,autoAim:intent.autoAim===true&&a.attrs.autoAim>0})}
  step(world,clean)
  for(const id of targets){const a=world.actors.get(id)!;if(!a.alive){a.alive=true;a.hp=a.attrs.maxHp;a.burn=undefined;a.shockTicks=0}}
  for(const m of members){const a=world.actors.get(m.actorId)!;a.hp=m.connected?a.attrs.maxHp:0;a.alive=m.connected;if(source.participants?.[m.actorId])world.participants![m.actorId]=structuredClone(source.participants[m.actorId]!)}
  world.pickups=[];world.projectiles=world.projectiles.slice(-512);world.mines=world.mines.slice(-96);world.effects=world.effects.slice(-64);world.floaters=world.floaters.slice(-64);world.gameOver=false;world.roomCleared=false;world.room.exit=null;world.room.phase='combat'
 }}
}
