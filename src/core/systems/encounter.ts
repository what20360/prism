import {distance} from '../collision'
import {hasLineOfSight} from '../navigation'
import type {Actor,World} from '../world'

export const ENCOUNTER_RULES={relayRange:720,relayArmor:35,relayTargets:2,chargeMin:170,chargeMax:430,chargeWindup:54,chargeTicks:24,chargeSpeed:3,chargeRecovery:36,chargeCooldown:150} as const
/** Rank targets per device once; a target covered by two devices uses the nearest, then lowest ID. */
export function relayAssignments(world:World):Map<number,Actor> {
 const actors=[...world.actors.values()],relays=actors.filter(a=>a.alive&&a.team==='enemy'&&a.behavior==='relay'),result=new Map<number,Actor>()
 if(!relays.length)return result
 for(const relay of relays){
  const nearby=actors.filter(a=>a.alive&&a.team==='enemy'&&a.behavior!=='relay'&&a.tier!=='boss'&&distance(a.pos,relay.pos)<=ENCOUNTER_RULES.relayRange&&hasLineOfSight(relay.pos,a.pos,world.room.walls)).sort((a,b)=>distance(a.pos,relay.pos)-distance(b.pos,relay.pos)||a.id-b.id)
  for(const target of nearby.slice(0,ENCOUNTER_RULES.relayTargets)){
   const prior=result.get(target.id)
   if(!prior||distance(target.pos,relay.pos)<distance(target.pos,prior.pos)||distance(target.pos,relay.pos)===distance(target.pos,prior.pos)&&relay.id<prior.id)result.set(target.id,relay)
  }
 }
 return result
}
export function supportingRelay(world:World,target:Actor):Actor|undefined {
 if(!target.alive||target.team!=='enemy'||target.behavior==='relay'||target.tier==='boss')return undefined
 let best:Actor|undefined,bestDistance=Infinity
 for(const relay of world.actors.values()){
  if(!relay.alive||relay.team!=='enemy'||relay.behavior!=='relay')continue
  const d=distance(target.pos,relay.pos)
  if(d>ENCOUNTER_RULES.relayRange||d>bestDistance||!hasLineOfSight(relay.pos,target.pos,world.room.walls))continue
  let closer=0
  for(const candidate of world.actors.values()){
   if(!candidate.alive||candidate.team!=='enemy'||candidate.behavior==='relay'||candidate.tier==='boss'||candidate.id===target.id)continue
   const c=distance(candidate.pos,relay.pos)
   if((c<d||c===d&&candidate.id<target.id)&&hasLineOfSight(relay.pos,candidate.pos,world.room.walls)&&++closer>=ENCOUNTER_RULES.relayTargets)break
  }
  if(closer<ENCOUNTER_RULES.relayTargets&&(d<bestDistance||!best||relay.id<best.id)){best=relay;bestDistance=d}
 }
 return best
}
