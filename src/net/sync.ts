import type { ActorView, ProjectileView, Snapshot } from '../core/snapshot'
import type { PlayState, Json } from './serverProtocol'
import { record, integer, array } from '../core/serialization'
// Field dictionaries are fixed by SERVER_PROTOCOL, never repeated per entity.
const ACTOR: readonly (keyof ActorView)[] = ['id','supportRelayId','channeling','team','tier','behavior','name','x','y','radius','coreRadius','hp','maxHp','armor','damage','fireRate','movementSpeed','rewardMultiplier','shield','moveX','moveY','alive','aimAngle','damageFlashTicks','deflectLevel','deflectActive','deflectReady','deflectCooldownSeconds','deflectCooldownTotal','deflectFieldRadius','range','fireCooldownSeconds','fireCooldownTotal','mineCooldownSeconds','mineCooldownTotal','autoAim','autoFire','vision','skills','locked','manualLocked','enraged','dashing','block','physicalResist','electricResist','heatResist','weapon','damageType','traits','bombTicks','windupTicks','windupAngle','shocked','burning','local','weaver','spider','stowed','shieldDisabledSeconds']
const BULLET:readonly (keyof ProjectileView)[]=['id','team','x','y','radius','vx','vy','speed','rangeRatio','rangeLeft','damageType','power']
const MINE=['id','team','x','y','bodyRadius','triggerRadius','blastRadius','slowRadius','fuseTicks','fuseTotal','grenade','ignoreBullets','child','pulsesRemaining','pulseCount','nestRole']
const PICKUP=['id','kind','pos','value','ttl','count','ownerId','contributions','gainApplied']
const SCHEMAS=[ACTOR,BULLET,MINE,PICKUP] as const
const GROUPS=['actors','projectiles','mines','pickups'] as const
interface Packed { meta:Record<string,Json>; groups:Json[][][] }
export interface DeltaGroup { up:Json[][]; patch:Json[][]; gone:number[] }
export interface SyncFrame { type:'sync'; serial:number; base:number; key:boolean; meta:Record<string,Json>; groups:DeltaGroup[] }
function normalize(value:unknown,quantize=true):Json {
 if(value===undefined||value===null)return null
 if(typeof value==='number')return quantize&&Math.abs(value)<1e12?Math.round(value*1000)/1000:value
 if(typeof value==='boolean'||typeof value==='string')return value
 if(Array.isArray(value))return value.map(v=>normalize(v,quantize))
 const result:Record<string,Json>={};for(const [key,v]of Object.entries(value))if(v!==undefined)result[key]=normalize(v,quantize);return result
}
function pack(state:PlayState):Packed {
 const {snapshot,...self}=state,{actors,projectiles,mines,pickups,effects,floaters,...scene}=snapshot
 const groups=[actors,projectiles,mines,pickups].map((items,g)=>items.map(item=>SCHEMAS[g]!.map(key=>normalize((item as unknown as Record<string,unknown>)[key]))))
 return {meta:{...normalize(self,false) as Record<string,Json>,...normalize(scene) as Record<string,Json>,shards:snapshot.shards,effects:normalize(effects.slice(-64)),floaters:normalize(floaters.slice(-64))},groups}
}
const same=(a:Json|undefined,b:Json|undefined)=>a===b||JSON.stringify(a)===JSON.stringify(b)
export function createSyncEncoder() {
 let previous:Packed|undefined,serial=0,keyAt=-Infinity
 return {reset:()=>{previous=undefined},encode:(state:PlayState,now:number):SyncFrame=>{
  const next=pack(state),key=!previous||now-keyAt>=5000,meta:Record<string,Json>={}
  for(const [k,v]of Object.entries(next.meta))if(key||!same(v,previous?.meta[k]))meta[k]=v
  if(!key)for(const k of Object.keys(previous!.meta))if(!(k in next.meta))meta[k]=null
  const groups=next.groups.map((rows,g)=>{
   const old=new Map((key?[]:previous!.groups[g]!).map(row=>[row[0] as number,row])),up:Json[][]=[],patch:Json[][]=[]
   for(const row of rows){const prior=old.get(row[0] as number);old.delete(row[0] as number)
    if(!prior){up.push(row);continue}
    const diff:Json[]=[row[0]!];for(let i=1;i<row.length;i++)if(!same(row[i],prior[i]))diff.push(i,row[i]!)
    if(diff.length>1){if(diff.length>=row.length)up.push(row);else patch.push(diff)}
   }
   return {up,patch,gone:[...old.keys()]}
  })
  const frame={type:'sync' as const,serial:++serial,base:key?0:serial-1,key,meta,groups};previous=next;if(key)keyAt=now;return frame
 }}
}
function unpack(p:Packed):PlayState {
 const {inputAck,waiting,startCountdown,attrs,purchases,plan,notice,knownSkills,restrictions,paused,label,mode,duel,...scene}=p.meta
 const entities=Object.fromEntries(GROUPS.map((name,g)=>[name,p.groups[g]!.map(row=>Object.fromEntries(SCHEMAS[g]!.flatMap((field,i)=>row[i]===null?[]:[[field,row[i]]])))]))
 // Fields with meaningful null (lock timers/name/exit) are retained where required.
 for(let i=0;i<p.groups[0]!.length;i++){const row=p.groups[0]![i]!,a=(entities.actors as Record<string,Json>[])[i]!;for(const field of ['name','bombTicks','windupTicks'] as const)a[field]=row[ACTOR.indexOf(field)]??null}
 for(let i=0;i<p.groups[2]!.length;i++)(entities.mines as Record<string,Json>[])[i]!.fuseTicks=p.groups[2]![i]![MINE.indexOf('fuseTicks')]??null
 return {inputAck,waiting,startCountdown,attrs,purchases,plan,notice,knownSkills,...(restrictions?{restrictions}:{}),paused,label,mode,...(duel?{duel}:{}),snapshot:{...scene,...entities,projectiles:(entities.projectiles as Record<string,Json>[]).map(p=>({...p,trail:[]}))}} as unknown as PlayState
}
export function createSyncDecoder() {
 let previous:Packed|undefined,serial=0
 return {reset:()=>{previous=undefined;serial=0},apply:(value:unknown):PlayState|null=>{
  const f=record(value);if(f.type!=='sync')throw new Error('无效快照');const nextSerial=integer(f.serial,1)
  if(nextSerial<=serial)return null
  if(typeof f.key!=='boolean')throw new Error('关键帧无效')
  if(!f.key&&(!previous||f.base!==serial))throw new Error('需要重新同步')
  const raw=record(f.meta),groups=array(f.groups,4);if(groups.length!==4)throw new Error('实体组无效')
  const meta={...(f.key?{}:previous!.meta),...raw} as Record<string,Json>,rows:Json[][][]=[]
  for(let g=0;g<4;g++){
   const delta=record(groups[g]),map=new Map((f.key?[]:previous!.groups[g]!).map(row=>[row[0] as number,row]))
   for(const id of array(delta.gone,4096))map.delete(integer(id,1))
   for(const value of array(delta.up,4096)){const row=array(value,SCHEMAS[g]!.length);if(row.length!==SCHEMAS[g]!.length)throw new Error('实体字段无效');const id=integer(row[0],1);map.set(id,row as Json[])}
   for(const value of array(delta.patch,4096)){const patch=array(value,128),id=integer(patch[0],1),prior=map.get(id);if(!prior||patch.length%2!==1)throw new Error('实体差量缺少基线');const row=[...prior];for(let i=1;i<patch.length;i+=2)row[integer(patch[i],1,SCHEMAS[g]!.length-1)]=patch[i+1] as Json;map.set(id,row)}
   if(map.size>4096)throw new Error('实体预算超出');rows.push([...map.values()])
  }
  const next={meta,groups:rows},state=unpack(next)
  if(!state.snapshot.bounds||!state.attrs||!Array.isArray(state.purchases)||!state.plan||!['dungeon','endless','duel'].includes(state.mode))throw new Error('快照缺少必要数据')
  previous=next;serial=nextSerial;return state
 }}
}
/** Display only: one network interval of interpolation, no client-authored damage or movement. */
export function createSnapshotInterpolator() {
 let from:Snapshot|undefined,to:Snapshot|undefined,at=0,duration=100
 const trails=new Map<number,{x:number;y:number}[]>()
 return {push:(s:Snapshot,now:number)=>{const sameRoom=to&&JSON.stringify(to.bounds)===JSON.stringify(s.bounds)&&s.tick>=to.tick;if(!sameRoom){from=undefined;trails.clear()}else from=to;duration=from?Math.max(30,Math.min(150,(s.tick-from.tick)*1000/60)):100;to=s;at=now},reset:()=>{from=undefined;to=undefined;trails.clear()},read:(now:number):Snapshot|undefined=>{
  if(!to)return undefined
  const alpha=Math.max(0,Math.min(1,(now-at)/duration)),actors=new Map(from?.actors.map(a=>[a.id,a])),bullets=new Map(from?.projectiles.map(p=>[p.id,p]))
  const blend=(a:number,b:number)=>a+(b-a)*alpha
  const projectiles=to.projectiles.map(p=>{const old=bullets.get(p.id),x=old?blend(old.x,p.x):p.x,y=old?blend(old.y,p.y):p.y,trail=trails.get(p.id)??[];const last=trail.at(-1);if(!last||Math.hypot(x-last.x,y-last.y)>.2){trail.push({x,y});if(trail.length>12)trail.shift()}trails.set(p.id,trail);return {...p,x,y,trail:[...trail]}})
  const live=new Set(to.projectiles.map(p=>p.id));for(const id of trails.keys())if(!live.has(id))trails.delete(id)
  return {...to,actors:to.actors.map(a=>{const old=actors.get(a.id);if(!old||Math.hypot(old.x-a.x,old.y-a.y)>250)return a;const angle=Math.atan2(Math.sin(a.aimAngle-old.aimAngle),Math.cos(a.aimAngle-old.aimAngle));return {...a,x:blend(old.x,a.x),y:blend(old.y,a.y),aimAngle:old.aimAngle+angle*alpha}}),projectiles}
 }}
}
