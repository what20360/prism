import { moveCircle } from '../core/systems/movement'
import type { Intent } from '../core/controller'
import type { Snapshot,ActorView } from '../core/snapshot'
import type { PlayState } from './serverProtocol'
interface Sample {sequence:number;at:number;move:{x:number;y:number}}
const MAX_LEAD=250,STALE_MS=350
/** Replays only unconsumed movement for the local display. Never authors authoritative state. */
export function createLocalPrediction(){
 let baseline:Snapshot|undefined,ack:PlayState['inputAck'],received=-Infinity,samples:Sample[]=[],lastDraw:{x:number;y:number}|undefined,offset={x:0,y:0},correctAt=0,localId=-1
 const local=(s:Snapshot)=>s.actors.find(a=>a.local===true)??s.actors.find(a=>a.team==='player')
 const reset=()=>{baseline=undefined;ack=undefined;received=-Infinity;samples=[];lastDraw=undefined;offset={x:0,y:0};localId=-1}
 const raw=(now:number)=>{
  const a=baseline&&local(baseline);if(!a)return undefined
  let pos={x:a.x,y:a.y}
  if(!a.alive||a.dashing||ack?.expired||now-received>STALE_MS)return pos
  const spans=samples.map((s,i)=>{const consumed=ack&&s.sequence===ack.sequence?ack.ticks*1000/60:0;return {sample:s,ms:ack&&s.sequence<ack.sequence?0:Math.max(0,(samples[i+1]?.at??now)-s.at-consumed)}})
  let excess=Math.max(0,spans.reduce((total,s)=>total+s.ms,0)-MAX_LEAD)
  for(const span of spans){
   const s=span.sample,drop=Math.min(excess,span.ms);excess-=drop;const ms=span.ms-drop;if(ms<=0)continue
   const length=Math.max(1,Math.hypot(s.move.x,s.move.y)),distance=Math.max(0,a.movementSpeed)*ms/1000
   const steps=Math.max(1,Math.ceil(distance/Math.max(4,a.radius*.5)))
   for(let step=0;step<steps;step++)pos=moveCircle(pos,a.radius,s.move.x/length*distance/steps,s.move.y/length*distance/steps,baseline!.bounds,baseline!.walls)
  }
  return pos
 }
 return {
  reset,
  record:(sequence:number,intent:Intent,now:number)=>{samples.push({sequence,at:now,move:{...intent.move}});samples=samples.filter(s=>now-s.at<=2000).slice(-64)},
  accept:(snapshot:Snapshot,inputAck:PlayState['inputAck'],now:number)=>{
   const a=local(snapshot),old=baseline&&local(baseline)
   if(!a){reset();return}
   const discontinuity=a.id!==localId||!a.alive||old?.alive===false||a.dashing||old&&Math.hypot(a.x-old.x,a.y-old.y)>Math.max(250,a.movementSpeed*.5)
   if(discontinuity){samples=[];lastDraw=undefined;offset={x:0,y:0}}
   baseline=snapshot;ack=inputAck;received=now;localId=a.id
   if(ack)samples=samples.filter(s=>s.sequence>=ack!.sequence)
   const next=raw(now)
   if(lastDraw&&next){const dx=lastDraw.x-next.x,dy=lastDraw.y-next.y;offset=Math.hypot(dx,dy)<=96?{x:dx,y:dy}:{x:0,y:0};correctAt=now}
  },
  stale:(now:number)=>Boolean(baseline)&&now-received>STALE_MS,
  read:(scene:Snapshot,now:number,intent?:Intent):Snapshot=>{
   const a=baseline&&local(baseline),pos=raw(now);if(!a||!pos)return scene
   const stale=now-received>STALE_MS||ack?.expired,decay=stale?0:Math.exp(-Math.max(0,now-correctAt)/65)
   const corrected=moveCircle(pos,a.radius,offset.x*decay,offset.y*decay,baseline!.bounds,baseline!.walls)
   lastDraw=corrected
   const aim=intent?.aim,angle=!intent?.autoAim&&aim&&Math.hypot(aim.x,aim.y)>0?Math.atan2(aim.y,aim.x):a.aimAngle
   const actor:ActorView={...a,x:corrected.x,y:corrected.y,aimAngle:angle}
   return {...scene,actors:scene.actors.map(v=>v.id===a.id?actor:v),traces:scene.traces?.map(t=>t.ownerId===a.id&&Math.hypot(t.from.x-a.x,t.from.y-a.y)<a.radius+64?{...t,from:{x:t.from.x+corrected.x-a.x,y:t.from.y+corrected.y-a.y}}:t)}
  }
 }
}
