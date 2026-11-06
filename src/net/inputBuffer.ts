import type { Intent } from '../core/controller'
/** Edge events survive render sampling until a packet is successfully sent. */
export function createInputBuffer(){
 let skills=new Set<number>(),lock:Intent['lockTarget'],mine=false,fire=false,latest:Intent={move:{x:0,y:0},fire:false}
 const reset=()=>{skills=new Set();lock=undefined;mine=false;fire=false;latest={move:{x:0,y:0},fire:false}}
 return {reset,push:(intent:Intent)=>{latest=intent;fire||=intent.fire===true;for(const id of intent.skills??[])skills.add(id);if(intent.lockTarget!==undefined)lock=intent.lockTarget;mine||=intent.placeMine===true},
  peek:():Intent=>({...latest,fire:latest.fire||fire,skills:[...skills],lockTarget:lock,placeMine:latest.placeMine||mine}),
  sent:()=>{skills.clear();lock=undefined;mine=false;fire=false}}
}
