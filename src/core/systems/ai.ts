import { circleIntersectsRect, resolveSpawnPosition } from '../collision'
import { ARSENAL_RULES } from '../rules'
import { selfDestruct } from './damage'
import { normalize } from '../math'
import { findPath, hasLineOfSight, firstWallHit } from '../navigation'
import type { World } from '../world'
import { tryGetPlayer, allocateId, spawnEnemy } from '../world'
import { updateWeaver, updateNestSpider } from './weaver'
import { ENCOUNTER_RULES } from './encounter'
import { combatAttrs } from '../combat'
import type { Actor } from '../world'
export function updateAi(world: World, controlled: ReadonlySet<number> = new Set()): void {
  for (const actor of world.actors.values()) {
    if (!actor.alive || actor.team === 'player' || controlled.has(actor.id)) continue
    const player = world.participants ? [...world.actors.values()].filter((a) => a.alive && world.participants![a.id] && a.team !== actor.team)
      .sort((a, b) => Math.hypot(a.pos.x - actor.pos.x, a.pos.y - actor.pos.y) - Math.hypot(b.pos.x - actor.pos.x, b.pos.y - actor.pos.y) || a.id - b.id)[0] : tryGetPlayer(world)
    if (!player) { actor.intent = { move: { x: 0, y: 0 }, fire: false }; continue }
    if (actor.behavior === 'relay') { actor.intent={move:{x:0,y:0},fire:false};continue }
    if (actor.behavior === 'weaver') { updateWeaver(world, actor, player); continue }
    if (actor.behavior === 'silk-worker' || actor.behavior === 'silk-bomber') { updateNestSpider(world, actor, player); continue }
    if (world.room.walls.some((wall) => circleIntersectsRect(actor.pos.x, actor.pos.y, actor.radius, wall))) {
      actor.pos = resolveSpawnPosition(actor.pos, actor.radius, world.room.walls, world.room.bounds); actor.navTimer = 0
    }
    const visible = hasLineOfSight(actor.pos, player.pos, world.room.walls)
    let move = { x: 0, y: 0 }
    if (actor.behavior !== 'turret' && actor.attrs.speed > 0) {
      if (hasLineOfSight(actor.pos, player.pos, world.room.walls, actor.radius)) actor.navPath = [player.pos]
      else if (actor.navTimer <= 0 || Math.hypot(player.pos.x - actor.navGoal.x, player.pos.y - actor.navGoal.y) > 120) {
        actor.navPath = findPath(world.room, actor.pos, player.pos, actor.radius)
        actor.navGoal = { ...player.pos }; actor.navTimer = 24 + actor.id % 9
      }
      actor.navTimer -= 1
      while (actor.navPath.length > 1 && hasLineOfSight(actor.pos, actor.navPath[1]!, world.room.walls, actor.radius)) actor.navPath.shift()
      const goal = actor.navPath[0]
      if (goal) move = normalize({ x: goal.x - actor.pos.x, y: goal.y - actor.pos.y })
    }
    const separation = Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y)
    if (actor.behavior === 'skirmish' && visible) {
      const toward = normalize({ x: player.pos.x - actor.pos.x, y: player.pos.y - actor.pos.y }), side = actor.id % 2 ? 1 : -1
      if (separation < 440) move = { x: -toward.x, y: -toward.y }
      else if (separation < 680) move = { x: -toward.y * side, y: toward.x * side }
    }
    if (actor.behavior !== 'boss' && (actor.behavior === 'bomber' || actor.traits?.includes('volatile'))) {
      if (actor.bombTicks === undefined && visible && separation <= ARSENAL_RULES.bombTrigger) actor.bombTicks = ARSENAL_RULES.bombFuse
      if (actor.bombTicks !== undefined) {
        actor.intent = { move: { x: 0, y: 0 }, fire: false }
        if (--actor.bombTicks <= 0) selfDestruct(world, actor)
        continue
      }
    }
    if ((actor.behavior==='blocker'||actor.behavior==='summoner') && updateSupport(world,actor,player,visible,separation)) continue
    if (actor.behavior === 'charger' && updateCharge(world,actor,player,visible,separation)) continue
    const lead = visible ? Math.min(0.25, Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) / Math.max(1, actor.attrs.bulletSpeed)) : 0
    if (actor.behavior === 'lancer') {
      if (!visible || separation > actor.attrs.range * 1.8 || actor.fireCooldownTicks > 0 || (actor.laserTicks ?? 0) > 0) actor.windupTicks = undefined
      else {
        if (actor.windupTicks === undefined) { actor.windupTicks = 36; actor.windupAngle = Math.atan2(player.pos.y - actor.pos.y, player.pos.x - actor.pos.x) }
        const armed = actor.windupTicks <= 0; actor.windupTicks = Math.max(0, actor.windupTicks - 1)
        actor.intent = { move: { x: 0, y: 0 }, fire: armed, aim: { x: Math.cos(actor.windupAngle!), y: Math.sin(actor.windupAngle!) } }
        continue
      }
    }
    actor.intent = { move, fire: actor.behavior === 'boss' || (visible && Math.hypot(player.pos.x - actor.pos.x, player.pos.y - actor.pos.y) <= actor.attrs.range),
      aim: normalize({ x: player.pos.x + player.intent.move.x * player.attrs.speed * lead - actor.pos.x,
        y: player.pos.y + player.intent.move.y * player.attrs.speed * lead - actor.pos.y }) }
  }
}

/** Direction is fixed throughout the warning and charge; collision interrupts on the next tick. */
function updateCharge(world:World,actor:Actor,player:Actor,visible:boolean,separation:number):boolean {
 const rules=ENCOUNTER_RULES, state=actor.charge
 if(state?.phase==='cooldown'){if(--state.ticks<=0)actor.charge=undefined;return false}
 if(state?.phase==='recovery'){actor.intent={move:{x:0,y:0},fire:false};if(--state.ticks<=0)actor.charge={phase:'cooldown',ticks:rules.chargeCooldown,angle:state.angle,last:{...actor.pos}};return true}
 if(state?.phase==='windup'){
  actor.intent={move:{x:0,y:0},fire:false};actor.aimAngle=state.angle
  if(--state.ticks<=0)actor.charge={phase:'dash',ticks:rules.chargeTicks,angle:state.angle,last:{...actor.pos}}
  return true
 }
 if(state?.phase==='dash'){
  const stuck=state.ticks<rules.chargeTicks&&Math.hypot(actor.pos.x-state.last.x,actor.pos.y-state.last.y)<.01
  const step=combatAttrs(actor).speed/60,to={x:actor.pos.x+Math.cos(state.angle)*step,y:actor.pos.y+Math.sin(state.angle)*step}
  const wall=firstWallHit(world.room,actor.pos,to,actor.radius)
  if(stuck||wall||state.ticks<=0){actor.charge={phase:'recovery',ticks:rules.chargeRecovery,angle:state.angle,last:{...actor.pos}};actor.intent={move:{x:0,y:0},fire:false};return true}
  state.last={...actor.pos};state.ticks--;actor.intent={move:{x:Math.cos(state.angle),y:Math.sin(state.angle)},fire:false};return true
 }
 if(visible&&separation>=rules.chargeMin&&separation<=rules.chargeMax){
  const angle=Math.atan2(player.pos.y-actor.pos.y,player.pos.x-actor.pos.x);actor.charge={phase:'windup',ticks:rules.chargeWindup,angle,last:{...actor.pos}};actor.intent={move:{x:0,y:0},fire:false};actor.aimAngle=angle;return true
 }
 return false
}

/** Fixed telegraphs and finite stock make support enemies readable and bounded. */
function updateSupport(world:World,actor:Actor,player:Actor,visible:boolean,separation:number):boolean {
 const stop=()=>{actor.intent={move:{x:0,y:0},fire:false}}
 if(actor.behavior==='blocker'){
  const state=actor.blocker
  if(state?.phase==='cooldown'){if(--state.ticks<=0)actor.blocker=undefined;return false}
  if(state?.phase==='windup'){
   stop();if(--state.ticks<=0){world.hazards??=[];if(world.hazards.length<4)world.hazards.push({id:allocateId(world),ownerId:actor.id,pos:{...state.target},radius:130,damage:actor.attrs.damage*.5,ttl:180,rewardMultiplier:actor.rewardMultiplier??1});actor.blocker={phase:'cooldown',ticks:240,target:state.target}}
   return true
  }
  if(visible&&separation<=700&&(world.hazards?.length??0)<4){actor.blocker={phase:'windup',ticks:60,target:{...player.pos}};stop();return true}
  return false
 }
 let state=actor.summoner
 if(!state){state=actor.summoner={phase:'cooldown',ticks:0,charges:2,target:{...actor.pos}}}
 if(state.phase==='cooldown'){
  if(state.ticks>0)state.ticks--
  if(state.ticks===0&&state.charges>0&&visible&&separation<=700&&[...world.actors.values()].filter(a=>a.alive&&a.summoned).length<6){
   const dir=normalize({x:player.pos.x-actor.pos.x,y:player.pos.y-actor.pos.y})
   state.phase='windup';state.ticks=60;state.target=resolveSpawnPosition({x:actor.pos.x+dir.x*125,y:actor.pos.y+dir.y*125},28,world.room.walls,world.room.bounds);stop();return true
  }
  return false
 }
 stop();if(--state.ticks<=0){
  if([...world.actors.values()].filter(a=>a.alive&&a.summoned).length<6){
   const attrs={...actor.attrs,maxHp:Math.max(1,actor.attrs.maxHp*.4),damage:actor.attrs.damage*.4,radius:28,armor:0,block:0,shield:0,shieldCapMult:0,shieldRegen:0,fireRate:0,weapon:0}
   spawnEnemy(world,{pos:state.target,attrs,tier:'normal',behavior:'chase',contactDamage:attrs.damage,hasCore:false,name:'召援体',summoned:true,rewardMultiplier:0});state.charges--
  }
  state.phase='cooldown';state.ticks=240
 }
 return true
}
