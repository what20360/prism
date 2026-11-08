/** Fixed-budget experiments invoke the real progression and 60 Hz simulation. */
import {CARD_REGISTRY} from '../content/cards'
import {DEFAULT_ECONOMY} from '../content/economy'
import {PLAYER_BASE_ATTRS} from '../content/player'
import {buyCard} from '../core/progress'
import {step} from '../core/simulation'
import {createActor,createWorld,getPlayer} from '../core/world'
import {TICK_RATE} from '../core/types'
import type {AttrSet} from '../core/attrs'

export interface BuildConfig {id:string;name:string;action:'shoot';opening:string[];cycle:string[]}
export interface Defense {armor?:number;block?:number;physicalResist?:number;electricResist?:number;heatResist?:number}
export interface Target {x:number;y:number;radius?:number;defense?:Defense}
export interface Scenario {id:string;name:string;defense?:Defense;targets:Target[]}
export interface ReportConfig {budgets:number[];warmupSeconds:number;measurementSeconds:number;seed:number;builds:BuildConfig[];scenarios:Scenario[]}
export interface PaidCard {id:string;name:string;level:number;price:number}
export interface Result {buildId:string;scenarioId:string;budget:number;spent:number;remaining:number;available:boolean;missing?:string;orders:PaidCard[];damage?:number;dps?:number;perTarget?:number[];averageTargetDps?:number;measurementSeconds?:number;cycleLimited?:boolean}
const zeroIntent={move:{x:0,y:0},fire:false}
const room={id:'benchmark',kind:'combat' as const,bounds:{x:0,y:0,width:4000,height:4000},walls:[],entry:{x:1500,y:2000},spawns:[],pickups:[]}
function newWorld(seed:number){return createWorld({seed,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room})}
const pos=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)
function assert(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(`实验配置无效：${message}`)}
export function validateConfig(input:unknown):ReportConfig {
 assert(input&&typeof input==='object'&&!Array.isArray(input),'需要对象')
 const c=input as ReportConfig
 assert(Array.isArray(c.budgets)&&c.budgets.length>0&&c.budgets.length<=30&&c.budgets.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1e7)&&new Set(c.budgets).size===c.budgets.length,'预算应为不重复的非负整数（至多30个）')
 assert(pos(c.warmupSeconds)&&c.warmupSeconds>=0&&c.warmupSeconds<=120&&Number.isInteger(c.warmupSeconds*TICK_RATE),'预热秒数无效')
 assert(pos(c.measurementSeconds)&&c.measurementSeconds>0&&c.measurementSeconds<=300&&Number.isInteger(c.measurementSeconds*TICK_RATE),'测量秒数无效')
 assert(Number.isSafeInteger(c.seed)&&c.seed>=0&&c.seed<=0xffffffff,'种子无效')
 assert(Array.isArray(c.builds)&&c.builds.length>0&&c.builds.length<=20&&Array.isArray(c.scenarios)&&c.scenarios.length>0&&c.scenarios.length<=30,'构筑或场景数量无效')
 const seenBuilds=new Set<string>(),seenScenes=new Set<string>()
 for(const b of c.builds){
  assert(b&&typeof b.id==='string'&&/^[a-z0-9-]+$/.test(b.id)&&!seenBuilds.has(b.id)&&typeof b.name==='string'&&b.name.length>0&&b.name.length<=80,'构筑标识或名称无效');seenBuilds.add(b.id)
  assert(b.action==='shoot','伤害曲线仅支持主武器射击（shoot）')
  assert(Array.isArray(b.opening)&&Array.isArray(b.cycle)&&b.cycle.length>0&&b.opening.length<=30&&b.cycle.length<=30,'购卡顺序无效')
  for(const id of [...b.opening,...b.cycle])assert(typeof id==='string'&&CARD_REGISTRY.get(id),`未知卡片 ${id}`)
  for(const id of b.cycle)assert(CARD_REGISTRY.get(id)!.maxLevel===undefined,`循环购卡不能包含限级卡 ${id}`)
 }
 const defense=(d:Defense|undefined)=>{if(d===undefined)return;assert(d&&typeof d==='object'&&!Array.isArray(d),'防御值无效');for(const [k,v]of Object.entries(d)){assert(['armor','block','physicalResist','electricResist','heatResist'].includes(k)&&pos(v)&&v>=-80&&v<=10000,`防御字段 ${k} 无效`);if(k==='armor'||k==='block')assert(v>=0,`${k} 不能为负`)}}
 for(const s of c.scenarios){
  assert(s&&typeof s.id==='string'&&/^[a-z0-9-]+$/.test(s.id)&&!seenScenes.has(s.id)&&typeof s.name==='string'&&s.name.length>0&&s.name.length<=80,'场景标识或名称无效');seenScenes.add(s.id);defense(s.defense)
  assert(Array.isArray(s.targets)&&s.targets.length>0&&s.targets.length<=12,'目标数应为1–12')
  for(const t of s.targets){assert(t&&pos(t.x)&&pos(t.y)&&Math.abs(t.x)<=1900&&Math.abs(t.y)<=1900&&(t.radius===undefined||pos(t.radius)&&t.radius>=5&&t.radius<=150),'目标位置或半径无效');defense(t.defense)}
  for(const [i,t] of s.targets.entries()){const radius=t.radius??34;assert(1500+t.x-radius>=0&&1500+t.x+radius<=4000&&2000+t.y-radius>=0&&2000+t.y+radius<=4000,'目标超出场地');assert(Math.hypot(t.x,t.y)>=radius+PLAYER_BASE_ATTRS.radius,'目标与玩家重叠');for(const previous of s.targets.slice(0,i))assert(Math.hypot(t.x-previous.x,t.y-previous.y)>=radius+(previous.radius??34),'目标互相重叠')}
 }
 return c
}
/** First failed affordability stops the ordered list, preserving user-chosen priorities. */
export function buyBuild(seed:number,budget:number,build:BuildConfig){
 const world=newWorld(seed);world.shards=budget;const orders:PaidCard[]=[]
 const buy=(id:string):boolean=>{
  const card=world.registry.get(id);if(!card)throw new Error(`未知卡片 ${id}`)
  const result=buyCard(world,id)
  if(!result.ok){if(result.reason==='not-enough-shards')return false;throw new Error(`构筑 ${build.id} 无法购买 ${id}：${result.reason}`)}
  const p=world.purchases.find(p=>p.id===id)!;orders.push({id,name:card.name,level:p.level,price:p.paid!.at(-1)!});return true
 }
 for(const id of build.opening)if(!buy(id))return {world,orders,available:false,missing:id}
 for(let i=0;i<10000;i++){if(!buy(build.cycle[i%build.cycle.length]!))return {world,orders,available:true};}
 throw new Error(`构筑 ${build.id} 超出购卡次数限制`)
}
/** Targets never move, do not attack, and have enough HP to prevent resets or overkill. */
export function runExperiment(config:ReportConfig,build:BuildConfig,scenario:Scenario,budget:number):Result {
 const {world,orders,available,missing}=buyBuild(config.seed,budget,build),spent=budget-world.shards
 const result:Result={buildId:build.id,scenarioId:scenario.id,budget,spent,remaining:world.shards,available,missing,orders}
 if(!available)return result
 const p=getPlayer(world),hp=1e9
 const targets=scenario.targets.map((t,i)=>createActor(world,{team:'enemy',behavior:'turret',tier:'normal',contactDamage:0,hasCore:false,damageIframesTicks:0,pos:{x:p.pos.x+t.x,y:p.pos.y+t.y},attrs:{...PLAYER_BASE_ATTRS,maxHp:hp,speed:0,fireRate:0,weapon:0,shield:0,shieldCapMult:0,shieldRegen:0,radius:t.radius??34,...scenario.defense,...t.defense} as AttrSet,name:`实验靶${i+1}`}))
 const first=scenario.targets[0]!,aim={x:first.x,y:first.y};p.lockTargetId=targets[0]!.id;p.manualLockId=targets[0]!.id
 const input={...zeroIntent,aim,fire:true}
 // Slow builds need several cooldowns: a short fixed window can report zero
 // even though a shot is merely waiting. Cap runtime and flag truncation.
 const cycleSeconds=1/Math.max(.000001,p.attrs.fireRate)
 const wantedSeconds=Math.max(config.measurementSeconds,10*cycleSeconds),actualTicks=Math.ceil(Math.min(1200,wantedSeconds)*TICK_RATE)
 const warmTicks=Math.round(config.warmupSeconds*TICK_RATE),testTicks=actualTicks,actualSeconds=actualTicks/TICK_RATE
 for(let i=0;i<warmTicks;i++)step(world,new Map([[p.id,input]]))
 const before=targets.map(a=>a.hp)
 for(let i=0;i<testTicks;i++)step(world,new Map([[p.id,input]]))
 if(targets.some(a=>!a.alive||a.hp<=0))throw new Error(`靶机生命耗尽：${build.id}/${scenario.id}/${budget}，请缩短测试时间或预算`)
 const perTarget=targets.map((a,i)=>(before[i]!-a.hp)/actualSeconds),dps=perTarget.reduce((a,b)=>a+b,0)
 return {...result,damage:dps*actualSeconds,dps,perTarget,averageTargetDps:dps/targets.length,measurementSeconds:actualSeconds,cycleLimited:wantedSeconds>1200}
}
export function runReport(config:ReportConfig):Result[]{return config.scenarios.flatMap(s=>config.builds.flatMap(b=>[...config.budgets].sort((a,b)=>a-b).map(n=>runExperiment(config,b,s,n))))}
