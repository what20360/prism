import { afterEach, describe, expect, it } from 'vitest'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { createWorld, getPlayer, createActor } from '../../src/core/world'
import { buyCard, sellCard } from '../../src/core/progress'
import { ARSENAL_RULES, laserProfile, penetrationProfile } from '../../src/core/rules'
import { hasAttackTarget } from '../../src/core/systems/targeting'
import { updateTimers } from '../../src/core/systems/timers'
import { looseLoot } from '../../src/core/loot'
import { safeRoom } from '../../src/content/levelSets'
import { bindings, setBinding, resetBindings } from '../../src/input/bindings'
function world() { return createWorld({ seed: 7, registry: CARD_REGISTRY, playerAttrs: PLAYER_BASE_ATTRS, economy: DEFAULT_ECONOMY, room: { id:'tuning',kind:'combat',bounds:{x:0,y:0,width:3200,height:1800},walls:[],entry:{x:500,y:500},spawns:[],pickups:[] } }) }
afterEach(resetBindings)
describe('weapon and control tuning',()=>{
 it('converts both sniper modifiers without their original penalties and restores normal bullets when sold',()=>{
  const w=world(),p=getPlayer(w);w.shards=1e6
  for(const id of ['precision-stance','burst','scatter','burst','scatter']) expect(buyCard(w,id).ok).toBe(true)
  expect(p.attrs.damage).toBeCloseTo(10*2*1.2*1.2);expect(p.attrs.range).toBe(1120);expect(p.attrs.multishot).toBe(1);expect(p.attrs.burstCount).toBe(1)
  sellCard(w,'precision-stance');expect(p.attrs.multishot).toBe(5);expect(p.attrs.burstCount).toBe(3);expect(p.attrs.damage).toBeCloseTo(10/1.4/1.8)
 })
 it('shares the requested laser, focus, scatter and penetration constants with card effects',()=>{
  expect(ARSENAL_RULES.laserDamage).toBe(0.3);expect(laserProfile(3).damageMultiplier).toBe(1.3);expect(penetrationProfile(2).rangeGain).toBe(400)
  expect(CARD_REGISTRY.get('scatter')!.effectFn(2,PLAYER_BASE_ATTRS).damage).toBeCloseTo(10/1.8)
  expect(CARD_REGISTRY.get('auto-aim')!.priceFn(1)).toBe(50);expect(CARD_REGISTRY.get('auto-fire')!.priceFn(1)).toBe(50)
 })
 it('gates automatic attacks by actual weapon range and line of sight',()=>{
  const w=world(),p=getPlayer(w),e=createActor(w,{team:'enemy',tier:'normal',behavior:'turret',hasCore:false,contactDamage:0,pos:{x:1100,y:500},attrs:PLAYER_BASE_ATTRS})
  expect(hasAttackTarget(w,p)).toBe(false);e.pos={x:900,y:500};expect(hasAttackTarget(w,p)).toBe(true)
  w.room.walls=[{x:700,y:400,width:40,height:200}];expect(hasAttackTarget(w,p)).toBe(false)
  w.room.walls=[];e.pos={x:1400,y:500};p.attrs={...p.attrs,weapon:2};expect(hasAttackTarget(w,p)).toBe(true)
 })
 it('requires stopping fire, mines and sustained laser before building out-of-combat time',()=>{
  const w=world(),p=getPlayer(w);p.outOfCombatTicks=999;p.intent={move:{x:0,y:0},fire:true};updateTimers(w);expect(p.outOfCombatTicks).toBe(0)
  p.intent={move:{x:0,y:0},fire:false};updateTimers(w);expect(p.outOfCombatTicks).toBe(1)
  p.laserTicks=10;updateTimers(w);expect(p.outOfCombatTicks).toBe(0)
 })
 it('makes every newly dropped denomination an individual entity',()=>{
  const pieces=looseLoot(624);expect(pieces).toHaveLength(16);expect(pieces.every((p)=>p.quantity===1)).toBe(true);expect(pieces.reduce((s,p)=>s+p.value,0)).toBe(624)
 })
 it('packs safe rooms into a small footprint with a valid portal',()=>{
  const room=safeRoom('safe');expect(room.bounds.width).toBe(1000);expect(room.bounds.height).toBe(700);expect(room.design!.exit.x+room.design!.exit.width).toBeLessThan(room.bounds.width)
 })
 it('updates key bindings immediately, rejects conflicts and restores defaults',()=>{
  resetBindings();expect(setBinding('mine','KeyQ')).toBe(true);expect(bindings().mine).toBe('KeyQ');expect(setBinding('skill1','KeyQ')).toBe(false);resetBindings();expect(bindings().mine).toBe('KeyE')
 })
})
