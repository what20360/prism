import {nextInt,type Rng} from '../core/rng'
export const ENCOUNTERS = [
 {id:'flank',name:'掩体夹击',roles:['stalker','turret','charger','blocker','drifter']},
 {id:'escort',name:'重甲护送',roles:['bulwark','lancer','summoner','drifter','turret']},
 {id:'volatile',name:'引爆窗口',roles:['bomber','summoner','stalker','drifter','turret']},
 {id:'arc',name:'电弧拉扯',roles:['arc-rider','charger','blocker','drifter','stalker']},
] as const
export type EncounterId=typeof ENCOUNTERS[number]['id']
export const encounterName=(id:string|undefined)=>ENCOUNTERS.find(e=>e.id===id)?.name
export function chooseEncounter(rng:Rng,recent:readonly string[]=[]):EncounterId {
 const candidates=ENCOUNTERS.filter(e=>!recent.slice(-2).includes(e.id))
 return candidates[nextInt(rng,0,candidates.length)]!.id
}
/** Rotate a seed-dependent cycle, so adjacent floors avoid the preceding two themes without storing history. */
export function endlessEncounter(seed:number,floor:number):EncounterId {
 const rng={state:(seed^0x513d091b)>>>0},start=nextInt(rng,0,ENCOUNTERS.length),reverse=nextInt(rng,0,2)===1?-1:1
 return ENCOUNTERS[((start+reverse*(floor-1))%ENCOUNTERS.length+ENCOUNTERS.length)%ENCOUNTERS.length]!.id
}
export function encounterEnemy(id:EncounterId,index:number,allowed:readonly string[]):string {
 const roles=ENCOUNTERS.find(e=>e.id===id)!.roles,available=roles.filter(role=>allowed.includes(role))
 return available[index%available.length]??'drifter'
}
export const RELAY_ANCHORS=[{x:1080,y:800},{x:2120,y:800}] as const
