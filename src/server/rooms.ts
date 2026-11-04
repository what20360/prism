import { randomBytes } from 'node:crypto'
import { createCoopMatch, readCoopSave, validateCoopConfig, type CoopMatch, type CoopSave } from '../app/modes/coop'
import { createDuelMatch, type DuelMatch } from '../app/modes/duel'
import { combatAttrs } from '../core/combat'
import { toSnapshot, toSkillView } from '../core/snapshot'
import { SKILL_IDS, unlocked } from '../core/systems/skills'
import { shortText, type RoomInfo, type RoomMember, type RoomOptions, type RoomSummary, type PlayState, type ServerCommand } from '../net/serverProtocol'
import { type Intent } from '../core/controller'
import { IDLE_INPUT } from '../net/control'
import type { PurchasePlan } from '../app/upgradePlans'
import { equalSecret, passwordHash, passwordMatches, type Identity } from './store'
export interface Room { id:string;options:Omit<RoomOptions,'password'>;password:string;ownerId:string;members:RoomMember[];banned:string[];epoch:number;lastActive:number;coop?:CoopMatch;duel?:DuelMatch;duelRound:number;roomIndex:number; }
export interface StoredRoom { id:string;options:Omit<RoomOptions,'password'>;password:string;ownerId:string;members:RoomMember[];banned:string[];lastActive:number;save:CoopSave }
export function cleanRoomOptions(value:unknown):RoomOptions {
 const v=value as Partial<RoomOptions>;if(!v||!['dungeon','endless','duel'].includes(v.mode??'')||!['fixed','budget','resource'].includes(v.duelMode??'')||typeof v.hidden!=='boolean')throw new Error('房间配置无效')
 const coop=validateCoopConfig(v.coop);if(v.mode!=='duel'&&coop.mode!==v.mode)throw new Error('房间模式不一致')
 return {name:shortText(v.name),mode:v.mode!,duelMode:v.duelMode!,hidden:v.hidden,password:shortText(v.password,64,true),coop}
}
function roomId():string {const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=randomBytes(6);return [...bytes].map(b=>alphabet[b%alphabet.length]).join('')}
export function roomSummary(room:Room):RoomSummary {return {id:room.id,name:room.options.name,mode:room.options.mode,duelMode:room.options.duelMode,count:room.members.filter(m=>m.connected).length,capacity:room.options.mode==='duel'?2:room.options.coop.maxPlayers,locked:Boolean(room.password),running:room.coop?room.coop.started()&&!room.coop.world().paused&&!room.coop.world().gameOver&&!room.coop.world().victory:['countdown','fighting'].includes(room.duel!.state().phase)}}
export function roomInfo(room:Room):RoomInfo {return {...roomSummary(room),epoch:room.epoch,members:room.members.map(m=>({...m,ready:room.coop?room.coop.world().coop!.members.find(p=>p.id===m.actorId)?.ready??false:room.duel!.state().ready[m.actorId-1]??false})),ownerId:room.ownerId,hidden:room.options.hidden,config:room.options.coop}}
export function createRoom(user:Identity,options:RoomOptions,now:number):Room {
 const {password,...safe}=options,room:Room={id:roomId(),options:safe,password:password?passwordHash(password):'',ownerId:user.id,members:[{userId:user.id,name:user.name,actorId:1,role:'owner',connected:true,ready:true}],banned:[],epoch:randomBytes(4).readUInt32BE(),lastActive:now,coop:options.mode==='duel'?undefined:createCoopMatch(options.coop),duel:options.mode==='duel'?createDuelMatch(options.coop.seed,options.duelMode):undefined,duelRound:0,roomIndex:0}
 if(room.coop){room.coop.world().coop!.members[0]!.name=user.name;room.coop.rename(options.name)}
 return room
}
export function joinRoom(room:Room,user:Identity,password:string,reconnect=false,seat?:number,passwordVerified=false):void {
 if(room.banned.includes(user.id))throw new Error('你已被此房间封禁')
 const old=room.members.find(m=>m.userId===user.id)
 if(old){if(room.coop&&!room.coop.world().coop!.members.find(m=>m.id===old.actorId)!.connected)room.coop.join(user.name,old.actorId);old.connected=true;old.name=user.name;if(room.coop)room.coop.world().coop!.members.find(m=>m.id===old.actorId)!.name=user.name;room.lastActive=Date.now();return}
 if(reconnect)throw new Error('没有可恢复的房间席位')
 if(!passwordVerified&&room.password&&!passwordMatches(password,room.password))throw new Error('房间密码不正确')
 const inherited=room.members.find(m=>m.userId.startsWith('unclaimed:')&&(seat===undefined||m.actorId===seat))
 if(inherited&&room.coop){room.coop.join(user.name,inherited.actorId);if(room.ownerId===inherited.userId)room.ownerId=user.id;inherited.userId=user.id;inherited.name=user.name;inherited.connected=true;inherited.ready=false;room.lastActive=Date.now();return}
 if(seat!==undefined)throw new Error('该存档角色没有可认领的席位')
 if(room.members.length>=roomSummary(room).capacity)throw new Error('房间已满（含保留的离线席位）')
 const actorId=room.coop?room.coop.join(user.name):room.members.some(m=>m.actorId===1)?2:1
 room.members.push({userId:user.id,name:user.name,actorId,role:'player',connected:true,ready:false});room.lastActive=Date.now()
}
export function disconnectRoom(room:Room,userId:string):void {
 const member=room.members.find(m=>m.userId===userId);if(!member)return;member.connected=false;member.ready=false
 if(room.coop)room.coop.disconnect(member.actorId)
 room.lastActive=Date.now()
}
export function removeRoomMember(room:Room,userId:string):void {
 const member=room.members.find(m=>m.userId===userId);if(!member)return
 if(room.duel&&['countdown','fighting'].includes(room.duel.state().phase))room.duel.forfeit((member.actorId-1) as 0|1)
 if(room.coop){room.coop.disconnect(member.actorId);room.coop.remove(member.actorId)}
 room.members=room.members.filter(m=>m!==member)
 if(room.ownerId===userId){const next=room.members.find(m=>m.connected&&m.role==='moderator')??room.members.find(m=>m.connected)??room.members[0];if(next){room.ownerId=next.userId;next.role='owner'}}
}
export function transferOwner(room:Room,target:RoomMember):void {const previous=room.members.find(m=>m.userId===room.ownerId);if(previous)previous.role='player';target.role='owner';room.ownerId=target.userId}
export function authorize(room:Room,userId:string,command:ServerCommand):RoomMember {
 const member=room.members.find(m=>m.userId===userId&&m.connected);if(!member)throw new Error('你不在此房间')
 if('epoch'in command&&command.epoch!==room.epoch)throw new Error('房间状态已变化，请等待同步后重试')
 if(['start','pause','restart','manage','import','close','rename'].includes(command.kind)&&member.role==='player')throw new Error('需要房间管理权限')
 if(['import','close'].includes(command.kind)&&member.role!=='owner')throw new Error('只有房主可以执行此操作')
 if(command.kind==='manage'){
  const target=room.members.find(m=>m.userId===command.target);if(!target||target===member)throw new Error('目标无效')
  if(['promote','demote','transfer'].includes(command.action)&&member.role!=='owner')throw new Error('只有房主可以分配权限')
  if(target.role==='owner'||member.role==='moderator'&&target.role!=='player')throw new Error('不能管理同级或更高权限成员')
 }
 return member
}
export function playState(room:Room,userId:string):PlayState {
 const member=room.members.find(m=>m.userId===userId)!,world=room.coop?.world()??room.duel!.world(),a=world.actors.get(member.actorId)!,duel=room.duel?.state(),progress=world.participants![member.actorId]!
 const {plans,notices,...score}=duel??{plans:undefined,notices:undefined}
 const restrictions=duel?.mode==='fixed'?Object.fromEntries(world.registry.all().map(c=>[c.id,'固定装备模式不能购买'])):world.cardRestrictions
 return {snapshot:toSnapshot(world,member.actorId),attrs:combatAttrs(a),purchases:progress.purchases,plan:room.coop?.plan(member.actorId)??plans?.[member.actorId-1]??{enabled:false,targets:[]} as PurchasePlan,notice:room.coop?.notice(member.actorId)??notices?.[member.actorId-1]??null,
  knownSkills:SKILL_IDS.filter(id=>unlocked(a.attrs,id)).map(id=>toSkillView(a,id)),restrictions,paused:room.coop?world.paused:room.members.filter(m=>m.connected).length<2||!['countdown','fighting'].includes(duel!.phase),label:room.coop?`${room.options.mode==='endless'?'无尽':'闯关'} · 房间 ${room.id} · ${room.coop.roomIndex()+1}`:`1v1 · 第${duel!.round}回合`,mode:room.options.mode,...(duel?{duel:score as PlayState['duel']}:{})}
}
export function tickRoom(room:Room,inputs:ReadonlyMap<string,{intent:Intent;offers:boolean}>):boolean {
 const online=room.members.filter(m=>m.connected);if(!online.length)return false
 if(room.coop){const next=new Map<number,Intent>();for(const m of online){const input=inputs.get(m.userId);next.set(m.actorId,input?.intent??IDLE_INPUT);room.coop.showOffers(m.actorId,input?.offers??false)}room.coop.tick(next);if(room.roomIndex!==room.coop.roomIndex()){room.roomIndex=room.coop.roomIndex();room.epoch++;return true}}
 else if(online.length===2){for(const m of online)room.duel!.showOffers((m.actorId-1) as 0|1,inputs.get(m.userId)?.offers??false);room.duel!.tick(inputs.get(room.members.find(m=>m.actorId===1)!.userId)?.intent??IDLE_INPUT,inputs.get(room.members.find(m=>m.actorId===2)!.userId)?.intent??IDLE_INPUT);if(room.duelRound!==room.duel!.state().round){room.duelRound=room.duel!.state().round;room.epoch++;return true}}
 return false
}
export function storedRoom(room:Room):StoredRoom|null {if(!room.coop)return null;return {id:room.id,options:room.options,password:room.password,ownerId:room.ownerId,members:room.members,banned:room.banned,lastActive:room.lastActive,save:room.coop.save()}}
export function restoreRoom(value:unknown):Room {
 const stored=value as StoredRoom,save=readCoopSave(JSON.stringify(stored.save),true),options=cleanRoomOptions({...stored.options,password:''})
 if(typeof stored.id!=='string'||!Array.isArray(stored.members)||stored.members.length>5||!stored.members.some(m=>m.userId===stored.ownerId)||stored.members.some(m=>typeof m.userId!=='string'||!save.world.coop!.members.some(s=>s.id===m.actorId))||new Set(stored.members.map(m=>m.userId)).size!==stored.members.length)throw new Error('房间身份绑定损坏')
 const coop=createCoopMatch(options.coop,save);for(const m of coop.world().coop!.members)if(m.connected)coop.disconnect(m.id)
 return {...stored,options:{...options,password:undefined} as Omit<RoomOptions,'password'>,coop,duel:undefined,epoch:randomBytes(4).readUInt32BE(),duelRound:0,roomIndex:save.roomIndex,members:stored.members.map(m=>({...m,connected:false,ready:false}))}
}
export function creationAllowed(policy:'open'|'key',key:string,expected:string):boolean {return policy==='open'||equalSecret(key,expected)}
