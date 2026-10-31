import { CARD_REGISTRY } from '../../content/cards'
import { buildDungeon } from '../../content/dungeon'
import { PLAYER_BASE_ATTRS } from '../../content/player'
import { DEFAULT_ECONOMY } from '../../content/economy'
import { dungeonDifficulty, DUNGEON_START_SHARDS, type DungeonDifficulty } from '../../content/difficulties'
import { createActor, createWorld, type World, type CoopResourceMode, type EnemySpawnSpec } from '../../core/world'
import { applyRoom } from '../../core/dungeon'
import { resolveSpawnPosition } from '../../core/collision'
import { nextFloat } from '../../core/rng'
import { step } from '../../core/simulation'
import type { Intent } from '../../core/controller'
import { buyCard, sellCard } from '../../core/progress'
import { shieldCap } from '../../core/attrs'
import { resolveAttrs } from '../../core/cards'
import { equipSkill } from '../../core/systems/skills'
import { serializeWorld, restoreWorld, record, integer, finite, array, type WorldData } from '../../core/serialization'
import { createEndlessMode, type EndlessCheckpoint } from './endless'
import { cleanAction } from '../../net/protocol'
import type { DuelAction } from '../../content/duel'
import { validateTargets, validateQuickMode, moveTarget, removeTarget, type PurchasePlan } from '../upgradePlans'
import { purchaseLevel } from '../../core/cards'
import { createPurchaseQueue } from '../purchaseQueue'
import type { PurchaseNotice } from '../purchaseQueue'
import { listCardStates } from '../../core/progress'

export interface CoopConfig { mode:'dungeon'|'endless'; seed:number; difficulty:DungeonDifficulty; maxPlayers:number; resourceMode:CoopResourceMode; baseShare:number; pauseOnDisconnect:boolean }
export const DEFAULT_COOP: CoopConfig = {mode:'dungeon',seed:20261031,difficulty:1,maxPlayers:5,resourceMode:'equal',baseShare:0.25,pauseOnDisconnect:true}
export interface CoopSave {format:'prism-coop-save';version:1;balanceVersion:5;name:string;savedAt:string;config:CoopConfig;hostId:number;roomIndex:number;started:boolean;world:WorldData;endless?:EndlessCheckpoint;plans:Record<number,PurchasePlan>}
export function validateCoopConfig(value:unknown):CoopConfig {
 const c=record(value);if(!['dungeon','endless'].includes(String(c.mode))||!['equal','killer','free','damage'].includes(String(c.resourceMode))||typeof c.pauseOnDisconnect!=='boolean')throw new Error('合作房间配置无效')
 return {mode:c.mode as CoopConfig['mode'],seed:integer(c.seed,0,0xffffffff),difficulty:dungeonDifficulty(c.difficulty),maxPlayers:integer(c.maxPlayers,1,5),resourceMode:c.resourceMode as CoopResourceMode,baseShare:finite(c.baseShare,0,1),pauseOnDisconnect:c.pauseOnDisconnect}
}
export function readCoopSave(text:string,allowEnded=false):CoopSave {
 if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error('合作存档不能超过2 MiB')
 const s=record(JSON.parse(text));if(s.format!=='prism-coop-save'||s.version!==1||s.balanceVersion!==5)throw new Error('请选择当前版本的合作存档')
 s.config=validateCoopConfig(s.config);if(typeof s.name!=='string'||!s.name.trim()||s.name.length>40||typeof s.savedAt!=='string'||!Number.isFinite(Date.parse(s.savedAt))||typeof s.started!=='boolean')throw new Error('合作存档信息无效')
 const w=restoreWorld(s.world,CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS));if(!w.coop||!w.participants||!allowEnded&&(w.gameOver||w.victory))throw new Error('合作进度已经结束或数据不完整')
 const cfg=s.config as CoopConfig;if(w.seed!==cfg.seed||w.coop.maxPlayers!==cfg.maxPlayers||w.coop.resourceMode!==cfg.resourceMode||w.coop.baseShare!==cfg.baseShare||w.coop.pauseOnDisconnect!==cfg.pauseOnDisconnect)throw new Error('房间配置与进度不一致')
 for(const [key,value]of Object.entries(PLAYER_BASE_ATTRS))if(w.basePlayerAttrs[key as keyof typeof PLAYER_BASE_ATTRS]!==value)throw new Error('合作初始属性无效')
 const ids=w.coop.members.map(m=>m.id);if(ids.some(id=>!w.participants?.[id]||!w.coop!.members.find(m=>m.id===id)!.connected&&w.coop!.members.find(m=>m.id===id)!.offlineHp>w.actors.get(id)!.attrs.maxHp))throw new Error('合作席位状态无效');if(ids.length>cfg.maxPlayers||Object.keys(w.participants).length!==ids.length||!ids.includes(integer(s.hostId,1)))throw new Error('队伍席位无效')
 for(const id of ids){const actor=w.actors.get(id)!,expected=resolveAttrs(w.basePlayerAttrs,w.participants[id]!.purchases,CARD_REGISTRY);for(const key of Object.keys(expected) as (keyof typeof expected)[])if(Math.abs(actor.attrs[key]-expected[key])>1e-7*Math.max(1,Math.abs(expected[key])))throw new Error('队员构筑无效')}
 integer(s.roomIndex,0,cfg.mode==='endless'?0:24)
 if(cfg.mode==='endless'){const e=record(s.endless);integer(e.floor,1);integer(e.rngState,0,0xffffffff);integer(e.respawned);array(e.spawnQueue,2000).forEach(t=>integer(t))}else if(s.endless!==undefined)throw new Error('闯关存档不能含无尽状态')
 const plans=record(s.plans);for(const [id,p]of Object.entries(plans)){if(!ids.includes(Number(id)))throw new Error('预购席位无效');const v=record(p);if(typeof v.enabled!=='boolean')throw new Error('预购开关无效');validateTargets(v.targets);if(v.quickMode!==undefined)validateQuickMode(v.quickMode)}
 return JSON.parse(JSON.stringify(s)) as CoopSave
}
export function coopPopulation(players:number):number {return 1+0.7*(Math.max(1,players)-1)}
export function createCoopMatch(config:CoopConfig=DEFAULT_COOP,saved?:CoopSave) {
 config=validateCoopConfig(config)
 const rooms=buildDungeon({seed:config.seed,difficulty:config.difficulty}), endless=config.mode==='endless'?createEndlessMode():undefined
 let world:World=saved?restoreWorld(saved.world,CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS)):createWorld({seed:config.seed,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room:endless?endless.room():rooms[0]!})
 const hostId=saved?.hostId??1
 let roomIndex=saved?.roomIndex??0,started=saved?.started??false
 const plans:Record<number,PurchasePlan>=structuredClone(saved?.plans??{}),queues=new Map<number,ReturnType<typeof createPurchaseQueue>>()
 const notices:Record<number,PurchaseNotice|null>={},offers:Record<number,boolean>={}
 let name=saved?.name??'合作进度'
 if(!saved){world.participants={1:{shards:DUNGEON_START_SHARDS,purchases:[],revivesUsed:0}};world.resourceDrops=true;world.cardRestrictions={revive:'合作模式统一5秒复活'};world.coop={members:[{id:1,name:'房主',connected:true,ready:true,reviveTicks:0,offlineHp:PLAYER_BASE_ATTRS.maxHp,offlineAlive:true}],resourceMode:config.resourceMode,baseShare:config.baseShare,maxPlayers:config.maxPlayers,roomPartySize:1,pauseOnDisconnect:config.pauseOnDisconnect};endless?.initialize(world)}
 else {for(const m of world.coop!.members) {const a=world.actors.get(m.id)!;if(m.connected){m.offlineHp=a.hp;m.offlineAlive=a.alive}m.connected=m.id===hostId;m.ready=m.id===hostId;if(!m.connected){a.alive=false;a.hp=0}else{a.alive=m.offlineAlive;a.hp=m.offlineHp}a.intent={move:{x:0,y:0},fire:false}} if(endless)endless.restore(world,saved.endless!)}
 world.paused=true
 const plan=(id:number)=>plans[id]??(plans[id]={targets:[],enabled:false,quickMode:'planned'})
 const teamPosition=(id:number)=>resolveSpawnPosition({x:world.room.entry.x+Math.cos(id*2.4)*70,y:world.room.entry.y+Math.sin(id*2.4)*70},world.actors.get(id)!.radius,world.room.walls,world.room.bounds)
 const rally=()=>{for(const m of world.coop!.members){const a=world.actors.get(m.id)!;a.pos=teamPosition(m.id);a.lockTargetId=null;a.manualLockId=null;a.burstRemaining=0;a.laserTicks=0;a.burn=undefined;a.rageTicks=0;a.dashTicks=0;a.shockTicks=0;a.deflectWindowTicks=0;a.intent={move:{x:0,y:0},fire:false};if(a.alive){a.iframesTicks=120;a.shield=Math.min(a.shield,shieldCap(a.attrs))} }}
 const scaleRoom=(index:number)=>{const room=rooms[index]!,count=Math.max(1,world.coop!.members.filter(m=>m.connected).length);world.coop!.roomPartySize=count
  const wave=(source:readonly EnemySpawnSpec[])=>{const result=[...source];const normal=source.filter(s=>s.tier!=='boss');const extra=normal.length?Math.ceil(normal.length*coopPopulation(count))-normal.length:(count-1)*2;for(let i=0;i<extra&&result.length<200;i++){const base=normal[i%normal.length]??source[0];if(!base)break;const anchor=room.design?.patrol[(i+2)%room.design.patrol.length]??base.pos;const attrs=base.tier==='boss'?{...base.attrs,maxHp:Math.max(20,base.attrs.maxHp*0.025),radius:30,armor:base.attrs.armor*0.2,block:0,speed:180,fireRate:0}:base.attrs;const pos=resolveSpawnPosition({x:anchor.x+(nextFloat(world.rng)-0.5)*130,y:anchor.y+(nextFloat(world.rng)-0.5)*130},attrs.radius,room.walls,room.bounds);result.push({...base,attrs,pos,...(base.tier==='boss'?{tier:'normal' as const,behavior:'chase' as const,hasCore:false,name:'巢室护卫',contactDamage:attrs.damage*0.5}:{})})}return result}
  return {...room,spawns:wave(room.spawns),waves:room.waves?.map(wave)} }
 const checkpoint=(viewer=hostId):CoopSave=>({format:'prism-coop-save',version:1,balanceVersion:5,name,savedAt:new Date().toISOString(),config,hostId:viewer,roomIndex,started,world:(()=>{const data=serializeWorld(world,true);for(const p of data.projectiles){delete p.trail;delete p.segments}data.floaters=data.floaters.slice(-80);data.effects=data.effects.slice(-80);return data})(),endless:endless?.checkpoint(),plans:structuredClone(plans)})
 return {
  world:()=>world,config:()=>({...config}),hostId:()=>hostId,started:()=>started,roomIndex:()=>roomIndex,plan,
  notice:(id:number)=>notices[id]??null,showOffers:(id:number,visible:boolean)=>{offers[id]=visible},
  save:checkpoint,rename:(value:string)=>{if(!value.trim()||value.trim().length>40)return false;name=value.trim();return true},
  join:(memberName:string,id?:number)=>{
   if(id!==undefined){const m=world.coop!.members.find(m=>m.id===id);if(!m||m.connected)throw new Error('席位已在线');m.connected=true;m.ready=false;const a=world.actors.get(id)!;a.alive=m.offlineAlive;a.hp=m.offlineHp;a.shield=0;a.iframesTicks=120;a.intent={move:{x:0,y:0},fire:false};return id}
   if(world.coop!.members.length>=config.maxPlayers)throw new Error('房间已满')
   const a=createActor(world,{team:'player',tier:'normal',behavior:'turret',contactDamage:0,hasCore:true,pos:world.room.entry,attrs:{...PLAYER_BASE_ATTRS}});a.pos=teamPosition(a.id);a.iframesTicks=120
   world.participants![a.id]={shards:DUNGEON_START_SHARDS,purchases:[],revivesUsed:0};world.coop!.members.push({id:a.id,name:memberName.trim().slice(0,24)||'队员',connected:true,ready:false,reviveTicks:0,offlineHp:a.hp,offlineAlive:true});return a.id
  },
  disconnect:(id:number)=>{const m=world.coop!.members.find(m=>m.id===id);if(!m?.connected)return;const a=world.actors.get(id)!;m.offlineHp=a.hp;m.offlineAlive=a.alive;m.connected=false;m.ready=false;a.alive=false;a.hp=0;a.shield=0;a.intent={move:{x:0,y:0},fire:false};if(config.pauseOnDisconnect)world.paused=true;const online=world.coop!.members.filter(m=>m.connected);if(started&&online.length&&online.every(m=>!world.actors.get(m.id)?.alive))world.gameOver=true},
  remove:(id:number)=>{if(id===hostId)return false;world.coop!.members=world.coop!.members.filter(m=>m.id!==id);world.actors.delete(id);delete world.participants![id];delete plans[id];return true},
  ready:(id:number,ready=true)=>{const m=world.coop!.members.find(m=>m.id===id&&m.connected);if(m)m.ready=ready},
  start:()=>{const online=world.coop!.members.filter(m=>m.connected);if(world.gameOver||world.victory||!online.length||!online.some(m=>world.actors.get(m.id)?.alive)||!started&&online.some(m=>!m.ready))return false;if(!started){if(endless)endless.initialize(world);else applyRoom(world,scaleRoom(roomIndex));rally()}started=true;world.paused=false;return true},
  pause:()=>{world.paused=true},
  restart:()=>{const state=structuredClone(world.coop!),room=endless?endless.room():rooms[0]!;world=createWorld({seed:config.seed,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room:{...room,pickups:[],spawns:[],waves:undefined}});const template=structuredClone(world.actors.get(1)!);world.actors.clear();world.participants={};for(const m of state.members){const a={...structuredClone(template),id:m.id,alive:m.connected,hp:m.connected?PLAYER_BASE_ATTRS.maxHp:0};world.actors.set(m.id,a);world.participants[m.id]={shards:DUNGEON_START_SHARDS,purchases:[],revivesUsed:0};m.reviveTicks=0;m.offlineHp=PLAYER_BASE_ATTRS.maxHp;m.offlineAlive=true;m.ready=m.id===hostId}world.nextEntityId=Math.max(...state.members.map(m=>m.id))+1;world.coop=state;world.resourceDrops=true;world.cardRestrictions={revive:'合作模式统一5秒复活'};roomIndex=0;started=false;queues.clear();for(const id of Object.keys(notices))delete notices[Number(id)];if(endless)endless.initialize(world);else applyRoom(world,room);world.paused=true},
  action:(id:number,value:unknown)=>{if(!world.coop!.members.some(m=>m.id===id&&m.connected)||world.gameOver||world.victory)return false;let a:DuelAction;try{a=cleanAction(value)}catch{return false}const p=plan(id)
   if(a.kind==='buy')return buyCard(world,a.id,id).ok
   if(a.kind==='sell')return sellCard(world,a.id,id)
   if(a.kind==='equip')return equipSkill(world.actors.get(id)!,a.slot,a.id)
   if(a.kind==='plan'){p.targets=validateTargets(a.targets);return true}
   if(a.kind==='auto'){p.enabled=a.enabled;return true}
   if(a.kind==='quick-mode'){p.quickMode=a.mode;return true}
   if(a.kind==='move'){p.targets=moveTarget(p.targets,a.index,a.direction);return true}
   if(a.kind==='remove'){p.targets=removeTarget(p.targets,a.index,k=>purchaseLevel(world.participants![id]!.purchases,k));return true}
   if(a.kind==='queue'){const level=a.level??Math.max(purchaseLevel(world.participants![id]!.purchases,a.id),...p.targets.filter(t=>t.id===a.id).map(t=>t.level))+1;p.targets=validateTargets([...p.targets,{id:a.id,level}]);return true}return false
  },
  tick:(inputs:ReadonlyMap<number,Intent>)=>{if(!started||world.paused)return;const clean=new Map<number,Intent>();for(const m of world.coop!.members)if(m.connected)clean.set(m.id,inputs.get(m.id)??{move:{x:0,y:0},fire:false});step(world,clean);if(world.gameOver||world.victory)return
   if(endless){const before=endless.state(world).floor;endless.afterStep(world);if(before!==endless.state(world).floor)rally()}
   else if(world.exitReached&&roomIndex+1<rooms.length){applyRoom(world,scaleRoom(++roomIndex));rally()}
   for(const m of world.coop!.members)if(m.connected){const q=queues.get(m.id)??createPurchaseQueue();queues.set(m.id,q);notices[m.id]=q.update(plan(m.id),listCardStates(world,m.id),1,k=>buyCard(world,k,m.id).ok,offers[m.id]!==false)}
  },
 }
}
export type CoopMatch=ReturnType<typeof createCoopMatch>
