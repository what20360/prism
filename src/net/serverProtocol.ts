import type { AttrSet } from '../core/attrs'
import type { Purchase } from '../core/cards'
import type { Snapshot, SkillView } from '../core/snapshot'
import type { Intent } from '../core/controller'
import type { DuelAction, DuelMode, DuelState } from '../content/duel'
import type { CoopConfig } from '../app/modes/coop'
import type { PurchasePlan } from '../app/upgradePlans'
import type { PurchaseNotice } from '../app/purchaseQueue'
import { record, integer } from '../core/serialization'
import { cleanAction, cleanIntent } from './control'
export const SERVER_PROTOCOL = 'prism-server-3'
export const NETWORK_INTERVAL = 100
export type RoomMode = 'dungeon' | 'endless' | 'duel'
export type RoomRole = 'owner' | 'moderator' | 'player'
export interface RoomOptions { name: string; mode: RoomMode; duelMode: DuelMode; coop: CoopConfig; hidden: boolean; password: string }
export interface RoomMember { userId: string; name: string; actorId: number; role: RoomRole; connected: boolean; ready: boolean }
export interface RoomSummary { id: string; name: string; mode: RoomMode; duelMode: DuelMode; count: number; capacity: number; locked: boolean; running: boolean }
export interface RoomInfo extends RoomSummary { waiting: boolean; startCountdown: number; epoch: number; members: RoomMember[]; ownerId: string; hidden: boolean; config: CoopConfig }
export interface PlayState {
 waiting: boolean; startCountdown: number; snapshot: Snapshot; attrs: AttrSet; purchases: Purchase[]; plan: PurchasePlan; notice: PurchaseNotice | null
 knownSkills: SkillView[]; restrictions?: Record<string,string>; paused: boolean; label: string; mode: RoomMode
 duel?: Omit<DuelState,'plans'|'notices'>
}
export type ServerCommand = {kind:'rename';roomId:string;epoch:number;name:string} | { kind: 'list' } | { kind: 'create'; options: RoomOptions; key: string } | { kind: 'join'; roomId: string; password: string; seat?: number } |
 { kind: 'leave' | 'ready' | 'cancel-start' | 'start' | 'pause' | 'restart' | 'export' | 'resync' | 'close'; roomId: string; epoch: number } |
 { kind: 'game'; roomId: string; epoch: number; action: DuelAction } |
 { kind: 'manage'; roomId: string; epoch: number; target: string; action: 'kick' | 'ban' | 'promote' | 'demote' | 'transfer' } |
 { kind: 'import'; roomId: string; epoch: number; save: unknown }
export type ClientPacket = { protocol: typeof SERVER_PROTOCOL; type: 'hello'; name: string; userId?: string; token?: string; serverId?: string } |
 { protocol: typeof SERVER_PROTOCOL; type: 'command'; requestId: string; command: ServerCommand } |
 { protocol: typeof SERVER_PROTOCOL; type: 'input'; roomId: string; epoch: number; sequence: number; intent: Intent; offers: boolean } |
 { protocol: typeof SERVER_PROTOCOL; type: 'ping'; time: number }
export interface ServerInfo { protocol: typeof SERVER_PROTOCOL; serverId: string; name: string; createPolicy: 'open' | 'key'; rooms: number; version: string }
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
/** Reject oversized/deep hostile trees before any room operation. */
export function parseJson(text: string, maxBytes = 2_300_000): unknown {
 if(new TextEncoder().encode(text).length>maxBytes)throw new Error('消息过大')
 const value: unknown=JSON.parse(text);let count=0
 const check=(v:unknown,depth:number)=>{if(++count>110000||depth>22)throw new Error('消息结构过大');if(typeof v==='number'&&!Number.isFinite(v))throw new Error('数值无效');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('字段无效');check(x,depth+1)}}
 check(value,0);return value
}
export function shortText(value: unknown, max=40, allowEmpty=false): string {
 if(typeof value!=='string'||value.trim().length>max||!allowEmpty&&!value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw new Error('文字无效')
 return value.trim()
}
export function decodeClient(text:string):ClientPacket {
 const p=record(parseJson(text));if(p.protocol!==SERVER_PROTOCOL)throw new Error('客户端与服务器版本不同，请更新游戏与服务器')
 if(p.type==='hello')return {protocol:SERVER_PROTOCOL,type:'hello',name:shortText(p.name,24),userId:p.userId===undefined?undefined:shortText(p.userId,80),token:p.token===undefined?undefined:shortText(p.token,100),serverId:p.serverId===undefined?undefined:shortText(p.serverId,80)}
 if(p.type==='ping')return {protocol:SERVER_PROTOCOL,type:'ping',time:integer(p.time)}
 if(p.type==='input')return {protocol:SERVER_PROTOCOL,type:'input',roomId:shortText(p.roomId,12),epoch:integer(p.epoch),sequence:integer(p.sequence),intent:cleanIntent(p.intent),offers:p.offers===true}
 if(p.type!=='command')throw new Error('未知消息')
 const c=record(p.command),kind=c.kind,requestId=shortText(p.requestId,80)
 if(kind==='list')return {protocol:SERVER_PROTOCOL,type:'command',requestId,command:{kind}}
 if(kind==='create')return {protocol:SERVER_PROTOCOL,type:'command',requestId,command:{kind,options:c.options as unknown as RoomOptions,key:shortText(c.key,128,true)}}
 if(kind==='join')return {protocol:SERVER_PROTOCOL,type:'command',requestId,command:{kind,roomId:shortText(c.roomId,12).toUpperCase(),password:shortText(c.password,64,true),seat:c.seat===undefined?undefined:integer(c.seat,1,100000)}}
 const base={roomId:shortText(c.roomId,12),epoch:integer(c.epoch)}
 let command:ServerCommand
 if(kind==='rename')command={...base,kind,name:shortText(c.name)}
 else if(['leave','ready','cancel-start','start','pause','restart','export','resync','close'].includes(String(kind)))command={...base,kind:kind as 'leave'}
 else if(kind==='game')command={...base,kind,action:cleanAction(c.action)}
 else if(kind==='import')command={...base,kind,save:c.save}
 else if(kind==='manage'&&['kick','ban','promote','demote','transfer'].includes(String(c.action)))command={...base,kind,target:shortText(c.target,80),action:c.action as 'kick'}
 else throw new Error('未知房间操作')
 return {protocol:SERVER_PROTOCOL,type:'command',requestId,command}
}
export function socketAddress(text:string):URL {
 const value=text.trim(),url=new URL(/^(https?|wss?):\/\//i.test(value)?value:`${/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(value)||/\.local(?::\d+)?$/.test(value)?'http':'https'}://${value}`)
 if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请输入有效服务器地址，不含账号或查询参数')
 if(url.pathname!=='/'&&url.pathname!=='/socket')throw new Error('请输入服务器根地址，例如 https://game.example.com')
 url.protocol=url.protocol==='https:'||url.protocol==='wss:'?'wss:':'ws:';url.pathname='/socket';return url
}
export function httpAddress(text:string):URL {const url=socketAddress(text);url.protocol=url.protocol==='wss:'?'https:':'http:';url.pathname='/';return url}
