import {distance} from '../collision'
import {hasLineOfSight} from '../navigation'
import {looseLoot} from '../loot'
import {allocateId,spawnEnemy,type World} from '../world'
import {applyDamage} from './damage'
export const OBJECTIVE_RULES={nodeRadius:200,mineRadius:160,holdTicks:120,warningTicks:90} as const
/** All decisions and one-shot transactions live in the deterministic world. */
export function updateObjectives(world:World):void {
 const o=world.room.objective;if(!o||world.room.phase==='entered'||o.phase==='complete')return
 const players=[...world.actors.values()].filter(a=>a.alive&&a.team==='player'&&(!world.coop||world.coop.members.some(m=>m.id===a.id&&m.connected)))
 if(o.phase==='await'){
  if(o.kind==='gate'){
   for(const [index,node] of o.nodes.entries())if(players.some(p=>distance(p.pos,node)<=OBJECTIVE_RULES.nodeRadius&&hasLineOfSight(p.pos,node,world.room.walls))){o.selected=index;o.phase='warning';o.timer=OBJECTIVE_RULES.warningTicks;break}
  }else if(world.roomCleared){
   const p=players.find(a=>distance(a.pos,o.nodes[0]!)<=OBJECTIVE_RULES.mineRadius&&Math.hypot(a.intent.move.x,a.intent.move.y)<.1&&hasLineOfSight(a.pos,o.nodes[0]!,world.room.walls))
   if(!p){o.hold=0;o.holder=null}else{if(o.holder!==p.id)o.hold=0;o.holder=p.id;if(++o.hold>=OBJECTIVE_RULES.holdTicks){o.phase='warning';o.timer=OBJECTIVE_RULES.warningTicks;world.roomCleared=false;world.room.phase='combat';world.room.exit=null;world.exitReached=false}}
  }
  return
 }
 if(o.phase==='warning'){
  if(--o.timer>0)return
  o.targets=o.spawns.map(spec=>{const pos=o.kind==='gate'&&o.selected===1?{x:world.room.bounds.x+world.room.bounds.width-(spec.pos.x-world.room.bounds.x),y:spec.pos.y}:spec.pos;return spawnEnemy(world,{...spec,pos}).id})
  o.phase='engaged';return
 }
 if(o.phase==='engaged'&&o.targets.every(id=>!world.actors.get(id)?.alive)){
  o.phase='complete'
  if(o.kind==='mine'&&!o.claimed){o.claimed=true;for(const stack of looseLoot(o.reward))world.pickups.push({id:allocateId(world),kind:'shard',value:stack.value,quantity:1,ttl:-1,pos:{...o.nodes[0]!}})}
 }
}
/** Area damage keeps the original owner's reward multiplier and respects cover. */
export function updateHazards(world:World):void {
 if(!world.hazards)return
 for(const h of world.hazards){
  if(h.ttl%30===0)for(const p of world.actors.values())if(p.alive&&p.team==='player'&&(!world.coop||world.coop.members.some(m=>m.id===p.id&&m.connected))&&distance(p.pos,h.pos)<=h.radius+p.radius&&hasLineOfSight(h.pos,p.pos,world.room.walls))applyDamage(world,{targetId:p.id,sourceId:h.ownerId,sourceTeam:'enemy',raw:h.damage,penetration:0,isCore:false,damageType:'electric',rewardMultiplier:h.rewardMultiplier})
  h.ttl--
 }
 world.hazards=world.hazards.filter(h=>h.ttl>0)
}
