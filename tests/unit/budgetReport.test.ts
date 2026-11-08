import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {buyBuild,runExperiment,runReport,validateConfig,type ReportConfig} from '../../src/analysis/budget'
import {CARD_REGISTRY} from '../../src/content/cards'
import {electricPeriod} from '../../src/core/rules'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'

const cfg=validateConfig(JSON.parse(readFileSync('config/balance-report.json','utf8')))
const config:ReportConfig={...cfg,budgets:[0,50,100],warmupSeconds:2,measurementSeconds:8}
const one=config.scenarios.find(s=>s.id==='single')!,blocked=config.scenarios.find(s=>s.id==='single-block')!
const b=(id:string)=>config.builds.find(x=>x.id===id)!
describe('fixed-budget battle experiments',()=>{
 it('uses real costs, strict order and independent budgets',()=>{
  const a=buyBuild(1,50,b('bullet')),c=buyBuild(1,100,b('bullet'))
  expect(a.orders.map(x=>[x.id,x.price])).toEqual([['gun-damage',10],['gun-firerate',12],['burst',26]])
  expect(a.world.shards).toBe(2);expect(c.orders.slice(0,a.orders.length)).toEqual(a.orders)
  for(const o of c.orders)expect(o.price).toBe(CARD_REGISTRY.get(o.id)!.priceFn(o.level))
 })
 it('does not pretend a locked weapon is available at inadequate budgets',()=>{
  const r=runExperiment(config,b('arc'),one,20);expect(r.available).toBe(false);expect(r.missing).toBe('weapon-electric');expect(r.dps).toBeUndefined();expect(r.remaining).toBe(20)
 })
 it('tracks theoretical single electric power and proportional block exactly',()=>{
  const build={id:'test',name:'test',action:'shoot' as const,opening:['weapon-electric'],cycle:['gun-damage']}
  const u=runExperiment(config,build,one,32),v=runExperiment(config,build,blocked,32)
  const expected=PLAYER_BASE_ATTRS.damage*60/electricPeriod(PLAYER_BASE_ATTRS.fireRate)
  expect(u.dps!).toBeCloseTo(expected,1);expect(v.dps!/u.dps!).toBeCloseTo(.4,2)
 })
 it('computes group total from each target and excludes mines from the default curves',()=>{
  const group=config.scenarios.find(s=>s.id==='group-near')!
  const near=runExperiment(config,b('bullet'),group,100)
  expect(near.dps!).toBeGreaterThan(0);expect(near.perTarget).toHaveLength(5)
  expect(near.averageTargetDps).toBeCloseTo(near.dps!/5)
  expect(cfg.builds.map(x=>x.id)).toEqual(['bullet','sniper','arc','laser'])
  const results=runReport({...config,budgets:[50],scenarios:[group]});expect(results).toHaveLength(4);expect(results.every(r=>r.buildId!=='mine')).toBe(true)
  expect(()=>validateConfig({...config,builds:[{...b('bullet'),action:'mine'}]})).toThrow(/仅支持主武器/)
 })
 it('extends slow sniper measurement beyond a single cooldown',()=>{
  const slow=runExperiment(config,b('sniper'),one,800)
  expect(slow.measurementSeconds!).toBeGreaterThan(100);expect(slow.dps!).toBeGreaterThan(0);expect(slow.cycleLimited).toBe(false)
 })
 it('is deterministic and reproduces all four weapon families',()=>{
  for(const id of ['bullet','sniper','arc','laser']){const a=runExperiment(config,b(id),one,100);expect(a.dps!).toBeGreaterThan(0);expect(runExperiment(config,b(id),one,100)).toEqual(a)}
 })
 it('rejects malformed data, unknown cards, duplicate budgets and illegal purchases',()=>{
  expect(()=>validateConfig({...config,budgets:[1,1]})).toThrow()
  expect(()=>validateConfig({...config,builds:[{...b('arc'),cycle:['missing']}]})).toThrow()
  expect(()=>buyBuild(1,100,{...b('arc'),cycle:['burst']})).toThrow(/requirements/)
 })
})
