import { cleanAction, cleanIntent } from './protocol'
import { finite, integer, record } from '../core/serialization'
import { readCoopSave, type CoopSave } from '../app/modes/coop'
import type { Intent } from '../core/controller'
import type { DuelAction } from '../content/duel'
import type { PurchaseNotice } from '../app/purchaseQueue'
import { CARD_REGISTRY } from '../content/cards'
export type CoopPacket={type:'hello';name:string}|{type:'input';sequence:number;intent:Intent;offers?:boolean}|{type:'action';sequence:number;action:DuelAction}|{type:'ready';sequence:number;ready:boolean}|{type:'state';serial:number;viewerId:number;save:CoopSave;notice?:PurchaseNotice|null}|{type:'ping'|'pong';time:number}
export function encodeCoop(packet:CoopPacket):string{return JSON.stringify({protocol:'prism-coop-1',...packet})}
export function decodeCoop(text:string):CoopPacket {
 if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error('合作消息过大')
 const p=record(JSON.parse(text));if(p.protocol!=='prism-coop-1')throw new Error('合作版本不匹配')
 if(p.type==='hello'){if(typeof p.name!=='string'||p.name.length>24||/[\u0000-\u001f]/.test(p.name))throw new Error('队员名称无效');return {type:'hello',name:p.name}}
 if(p.type==='ping'||p.type==='pong')return {type:p.type,time:finite(p.time,0)}
 if(p.type==='input')return {type:'input',sequence:integer(p.sequence),intent:cleanIntent(p.intent),offers:p.offers!==false}
 if(p.type==='action')return {type:'action',sequence:integer(p.sequence),action:cleanAction(p.action)}
 if(p.type==='ready'){if(typeof p.ready!=='boolean')throw new Error('准备状态无效');return {type:'ready',sequence:integer(p.sequence),ready:p.ready}}
 if(p.type==='state'){const save=readCoopSave(JSON.stringify(p.save),true),viewerId=integer(p.viewerId,1);if(!save.world.coop!.members.some(m=>m.id===viewerId))throw new Error('席位无效');if(p.notice){const n=record(p.notice);if(typeof n.id!=='string'||!CARD_REGISTRY.get(n.id)||typeof n.auto!=='boolean')throw new Error('购买提示无效');integer(n.level,1);finite(n.price,0);integer(n.remainingTicks,0,180)}return {type:'state',serial:integer(p.serial),viewerId,save,notice:p.notice as PurchaseNotice|null|undefined}}
 throw new Error('未知合作消息')
}
