// @vitest-environment happy-dom
import {afterEach,describe,expect,it} from 'vitest'
import {createAttributeModel,attributeReference,radarRatio,weaponMetrics} from '../../src/ui/attributeModel'
import {renderAttrsSection} from '../../src/ui/sections/attrs'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {CARD_REGISTRY} from '../../src/content/cards'
import {resolveAttrs,type Purchase} from '../../src/core/cards'
import {shieldCap,type AttrSet} from '../../src/core/attrs'
import {ARSENAL_RULES,laserProfile,arcProfile} from '../../src/core/rules'
afterEach(()=>{sessionStorage.clear();document.body.replaceChildren()})
const attrs=(p:Purchase[])=>resolveAttrs(PLAYER_BASE_ATTRS,p,CARD_REGISTRY)
function render(a:AttrSet=PLAYER_BASE_ATTRS){const root=renderAttrsSection({attrs:a,hp:a.maxHp,shield:0,shieldCap:shieldCap(a)});document.body.replaceChildren(root);return root}
const ids=(a:AttrSet)=>createAttributeModel(a).groups.flatMap(g=>g.blocks.flatMap(b=>b.rows.map(r=>r.id)))
describe('current-weapon attribute sheet',()=>{
 it('hides unrelated and unselected mechanisms completely, and folds low-priority defaults',()=>{
  const root=render(),keys=ids(PLAYER_BASE_ATTRS)
  for(const key of ['arcRetention','laserPower','pulseCount','homingTurn','sniperPower','maxProjectiles','deflectLevel','children','shieldCap','lifesteal'])expect(keys).not.toContain(key)
  expect(root.querySelector('.attribute-sheet__extras')!.hasAttribute('open')).toBe(false)
  expect(root.querySelector('[data-attr="radius"]')!.closest('details')).toBeTruthy()
  expect(root.querySelector('[data-attr="hitDamage"]')!.closest('details')).toBeNull()
  expect(root.querySelectorAll('.attribute-radar')).toHaveLength(2)
 })
 it.each(['weapon-electric','weapon-laser'])('only exposes relevant parameters for %s even when other specializations were owned',weapon=>{
  const a=attrs([{id:weapon,level:1},{id:'homing',level:2},{id:'sniper-specialty',level:2},{id:'arc-coil',level:2},{id:'laser-focus',level:2}]),keys=ids(a)
  for(const key of ['bulletSpeed','initialSpeed','homingTurn','sniperPower','maxProjectiles'])expect(keys).not.toContain(key)
  if(weapon==='weapon-electric'){expect(keys).toEqual(expect.arrayContaining(['arcRetention','arcEfficiency','hopRange']));expect(keys).not.toContain('pulseCount')}
  else{expect(keys).toEqual(expect.arrayContaining(['pulseCount','laserPower','laserSpread']));expect(keys).not.toContain('arcRetention')}
 })
 it('shows one-bullet limits only for the sniper, then hides them after switching weapons',()=>{
  const a=attrs([{id:'precision-stance',level:1},{id:'sniper-specialty',level:2}]),root=render(a)
  expect(root.querySelector('[data-attr="maxProjectiles"]')!.textContent).toContain('1 颗')
  expect(root.querySelector('[data-attr="sniperPower"]')).toBeTruthy()
  expect(ids(attributeReference(0))).not.toContain('maxProjectiles')
 })
 it('promotes changed families while keeping shield, armor, homing and mine formulas adjacent',()=>{
  const a=attrs([{id:'shield',level:2},{id:'armor',level:1},{id:'homing',level:1},{id:'mine-power',level:1}]),root=render(a)
  for(const family of ['shield','armor','velocity','mineMain']){
   const block=root.querySelector(`[data-block="${family}"]`)!
   expect(block.closest('.attribute-sheet__extras')).toBeNull();expect(block.querySelector('.attrs__row--changed')).toBeTruthy()
  }
  const shield=root.querySelector('[data-block="shield"]')!
  expect(Array.from(shield.querySelectorAll('[data-attr]')).map(n=>(n as HTMLElement).dataset.attr)).toEqual(['shieldCap','shieldCapMult','shieldRegen'])
  expect(shield.textContent).toContain('10');expect(root.querySelectorAll('.attribute-radar')).toHaveLength(3)
  expect(root.querySelector('[data-attr="homingTurn"]')!.textContent).toContain('弧度/秒')
 })
 it('handles zero fire rate without bogus DPS or nonfinite SVG geometry and preserves input',()=>{
  const a={...PLAYER_BASE_ATTRS,fireRate:0},before=JSON.stringify(a),root=render(a)
  expect(root.querySelector('[data-attr="cooldown"]')!.textContent).toContain('无法开火')
  expect(root.innerHTML).not.toMatch(/NaN|Infinity/);expect(JSON.stringify(a)).toBe(before)
 })
 it('keeps the expanded optional-attributes preference across refreshes',async()=>{
  const root=render(),details=root.querySelector<HTMLDetailsElement>('.attribute-sheet__extras')!;details.open=true;details.dispatchEvent(new Event('toggle'));await Promise.resolve()
  expect(render().querySelector<HTMLDetailsElement>('.attribute-sheet__extras')!.open).toBe(true)
  const chart=document.querySelector<HTMLDetailsElement>('.attribute-radar details')!;chart.open=true;chart.dispatchEvent(new Event('toggle'));expect(render().querySelector<HTMLDetailsElement>('.attribute-radar details')!.open).toBe(true)
 })
})
describe('radar scales and shared weapon calculations',()=>{
 it('uses independent monotonic scales, with standard values at 50% and no growth cap',()=>{
  expect(radarRatio(50,50)).toBe(.5);expect(radarRatio(100,50)).toBeCloseTo(2/3)
  expect(radarRatio(700,700)).toBe(.5);expect(radarRatio(.1,.1)).toBe(.5)
  expect(radarRatio(0,50)).toBe(0);expect(radarRatio(-1,50)).toBe(0);expect(radarRatio(NaN,50)).toBe(0)
  expect(radarRatio(Number.MAX_VALUE,50)).toBeGreaterThan(.99)
  expect(weaponMetrics({...PLAYER_BASE_ATTRS,fireRate:1000}).frequency).toBe(60)
 })
 it('generates six weapon-specific axes with exact formulas and baseline polygons',()=>{
  for(const weapon of [0,1,2,3]){
   const a=attributeReference(weapon),model=createAttributeModel(a);expect(model.radars).toHaveLength(2)
   for(const radar of model.radars){expect(radar.axes).toHaveLength(6);expect(radar.axes.every(x=>x.scale>0)).toBe(true);for(const axis of radar.axes)expect(axis.value).toBe(axis.base)}
   const root=render(a);expect(root.querySelectorAll('svg[role="img"]')).toHaveLength(2)
   expect(root.querySelectorAll('svg desc')).toHaveLength(2);expect(root.querySelectorAll('.attribute-radar__table tbody tr')).toHaveLength(12)
   expect(root.querySelectorAll('.attribute-radar__current')).toHaveLength(2)
  }
 })
 it('shows actual energy ray ceilings and depth limited by both burst and penetration',()=>{
  const a={...attributeReference(1),multishot:1000,burstCount:20,pierce:3},m=weaponMetrics(a)
  expect(m.energyRays).toBe(64);expect(m.arcDepth).toBe(3)
  const chart=createAttributeModel(a).radars[0]!
  expect(chart.axes.find(x=>x.id==='coverage')!.value).toBe(64);expect(chart.axes.find(x=>x.id==='depth')!.value).toBe(3)
 })
 it('includes sustained attack time, current speed kinetic damage, and weapon specializations',()=>{
  const laser=attrs([{id:'weapon-laser',level:1},{id:'laser-focus',level:2},{id:'burst',level:2}]),lm=weaponMetrics(laser)
  expect(lm.damage).toBe(laser.damage*ARSENAL_RULES.laserDamage*laserProfile(2).damageMultiplier)
  expect(lm.duration).toBe(0.6);expect(lm.pulseCount).toBe(6);expect(lm.frequency).toBeCloseTo(1/(Math.max(1,Math.round(60/laser.fireRate))/60+0.6))
  const arc=attrs([{id:'weapon-electric',level:1},{id:'arc-coil',level:2}]);expect(weaponMetrics(arc).damage).toBe(arc.damage*arcProfile(2).damageMultiplier)
  const sniper=attrs([{id:'precision-stance',level:1},{id:'sniper-specialty',level:1}]);expect(weaponMetrics(sniper).fullSpeedDamage).toBe(sniper.damage+sniper.bulletSpeed*.01*sniper.damageScale)
 })
})
