import type { EnemySpawnSpec, ObjectiveSpec } from '../core/world'
/** The gate reserves part of the existing wave; the mine is an optional bounded encounter. */
export function buildRoomObjective(id:string|undefined,spawns:EnemySpawnSpec[],depth:number):ObjectiveSpec|undefined {
 if(id==='cross-gate' && spawns.length>=2){
  const batch=spawns.splice(Math.max(1,spawns.length-Math.min(4,Math.floor(spawns.length/2))))
  return {kind:'gate',nodes:[{x:850,y:1080},{x:2350,y:1080}],spawns:batch.map((s,i)=>({...s,pos:{x:350+i*170,y:330+(i%2)*130}})),reward:0}
 }
 if(id==='unstable-mine'){
  const batch=spawns.filter(s=>!['relay','weaver'].includes(s.behavior)).slice(0,2)
  if(!batch.length)return undefined
  return {kind:'mine',nodes:[{x:2300,y:1050}],spawns:batch.map((s,i)=>({...s,pos:{x:2100+i*400,y:780}})),reward:Math.min(625,Math.round(25*1.13**depth))}
 }
 return undefined
}
