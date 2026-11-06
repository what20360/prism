import {describe,expect,it} from 'vitest'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {CARD_REGISTRY} from '../../src/content/cards'
import {DEFAULT_ECONOMY} from '../../src/content/economy'
import {createActor,createWorld,getPlayer} from '../../src/core/world'
import {fireElectric} from '../../src/core/systems/energyWeapons'
import {updateWeapons} from '../../src/core/systems/weapons'
import {electricPeriod} from '../../src/core/rules'
import {serializeWorld,restoreWorld} from '../../src/core/serialization'
import {hashWorld} from '../../src/core/hash'
import type {AttrSet} from '../../src/core/attrs'
function arena(a:Partial<AttrSet>={},defense:Partial<AttrSet>={}){
 const w=createWorld({seed:52,economy:DEFAULT_ECONOMY,registry:CARD_REGISTRY,playerAttrs:{...PLAYER_BASE_ATTRS,weapon:1,damage:30,range:800,...a},room:{id:'current',kind:'combat',bounds:{x:0,y:0,width:2000,height:1200},walls:[],spawns:[],pickups:[],entry:{x:100,y:500}}})
 for(const [x,y] of [[400,500],[600,600],[600,400]])createActor(w,{team:'enemy',behavior:'turret',tier:'normal',contactDamage:0,hasCore:false,pos:{x:x!,y:y!},attrs:{...PLAYER_BASE_ATTRS,maxHp:100000,fireRate:0,...defense}})
 getPlayer(w).intent={move:{x:0,y:0},aim:{x:1,y:0},fire:true};return w
}
const targets=(w:ReturnType<typeof arena>)=>[...w.actors.values()].filter(a=>a.team==='enemy')
describe('continuous electric energy and block budget',()=>{
 it.each([.7,2,12,120])('preserves former steady DPS at fire rate %s, including each independent branch and block',fireRate=>{
  for(const defense of [{},{block:4},{block:4,armor:80,electricResist:50},{block:1000}]){
   const a={fireRate,multishot:2,burstCount:3,pierce:5,arcEfficiency:2},continuous=arena(a,defense),reference=arena(a,defense)
   fireElectric(reference,getPlayer(reference),0)
   for(let tick=0;tick<413;tick++)updateWeapons(continuous)
   getPlayer(continuous).intent={...getPlayer(continuous).intent,fire:false};updateWeapons(continuous)
   for(let index=0;index<3;index++)expect(100000-targets(continuous)[index]!.hp).toBeCloseTo((100000-targets(reference)[index]!.hp)*413/electricPeriod(fireRate),6)
   expect(continuous.traces!.length).toBeLessThanOrEqual(6);expect(continuous.projectiles).toHaveLength(0)
  }
 })
 it('cannot obtain a free full shot by repeatedly tapping, and does not bank idle time',()=>{
  const w=arena({fireRate:2}),p=getPlayer(w)
  for(let i=0;i<60;i++){p.intent={...p.intent,fire:true};updateWeapons(w);p.intent={...p.intent,fire:false};updateWeapons(w)}
  expect(100000-targets(w)[0]!.hp).toBeCloseTo(60)
  const before=targets(w)[0]!.hp;for(let i=0;i<500;i++)updateWeapons(w)
  expect(targets(w)[0]!.hp).toBe(before);expect(p.electricBudget).toBe(0)
 })
 it('stops at cover, switches target continuously and never preserves a dead player charge',()=>{
  const w=arena(),p=getPlayer(w);updateWeapons(w);const before=targets(w)[0]!.hp
  w.room.walls=[{x:200,y:0,width:30,height:1200}];for(let i=0;i<60;i++)updateWeapons(w)
  expect(targets(w)[0]!.hp).toBe(before)
  w.room.walls=[];p.lockTargetId=targets(w)[1]!.id;for(let i=0;i<6;i++)updateWeapons(w)
  expect(targets(w)[1]!.hp).toBeLessThan(100000)
  p.alive=false;updateWeapons(w);expect(p.electricBudget).toBe(0);expect(p.electricTimer).toBe(0)
 })
 it('restores a partially charged channel deterministically without requiring new fields in old saves',()=>{
  const w=arena();for(let i=0;i<4;i++)updateWeapons(w)
  const copy=restoreWorld(serializeWorld(w,true),CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS))
  for(let i=0;i<40;i++){updateWeapons(w);updateWeapons(copy);expect(hashWorld(copy)).toBe(hashWorld(w))}
  const data=serializeWorld(w,true);for(const a of data.actors){delete a.electricBudget;delete a.electricTimer}
  expect(()=>restoreWorld(data,CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS))).not.toThrow()
 })
})
