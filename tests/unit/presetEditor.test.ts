// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanManager } from '../../src/app/planManager'
import { renderPlansSection } from '../../src/ui/sections/plans'
import { renderSettingsSection } from '../../src/ui/sections/settings'
import { appendPresetTargets, duplicatePresetTarget, presetCost, readPreset } from '../../src/app/upgradePlans'
import { CARD_REGISTRY } from '../../src/content/cards'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_SETTINGS } from '../../src/storage/config'

afterEach(()=>{document.body.replaceChildren();localStorage.clear();sessionStorage.clear()})
const input=(name:string)=>document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!
const click=(name:string)=>{const b=document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);expect(b).toBeTruthy();b!.click()}
function editor(){
 const manager=createPlanManager({game:()=>undefined,refresh:()=>render(),saved:()=>{}})
 function render(){document.body.replaceChildren(renderPlansSection(manager.state(),manager.actions))}
 render();return manager
}
describe('direct preset editing',()=>{
 it('adds prerequisites once, appends batches in order and calculates every intermediate price',()=>{
  const targets=appendPresetTargets([], 'ricochet',20)
  expect(targets).toEqual([{id:'gun-pierce',level:1},{id:'ricochet',level:1}])
  const repeated=appendPresetTargets(appendPresetTargets(targets,'gun-damage',2),'gun-range',1)
  const next=duplicatePresetTarget(repeated,2)
  expect(next.slice(2)).toEqual([{id:'gun-damage',level:1},{id:'gun-damage',level:2},{id:'gun-damage',level:3},{id:'gun-range',level:1}])
  expect(presetCost(next)).toBe(['gun-pierce','ricochet','gun-range'].reduce((sum,id)=>sum+CARD_REGISTRY.get(id)!.priceFn(1),0)+10+15+23)
  const laser=appendPresetTargets([],'laser-focus',2);expect(laser).toEqual([{id:'weapon-laser',level:1},{id:'laser-focus',level:1},{id:'laser-focus',level:2}])
  expect(()=>appendPresetTargets(laser,'weapon-laser')).toThrow();expect(()=>appendPresetTargets([],'homing',51)).toThrow()
 })
 it('searches and filters the directory, then retains filters after repeated clicks and batch additions',()=>{
  const m=editor(),search=input('搜索预设卡片');search.value='伤害';search.dispatchEvent(new Event('input'))
  const category=input('预设卡片分类');category.value='damage';category.dispatchEvent(new Event('change'))
  expect(document.querySelectorAll('.preset-card')).toHaveLength(9)
  click('追加弹头强化');expect(m.state().draft.targets).toEqual([{id:'gun-damage',level:1}])
  expect(input('搜索预设卡片').value).toBe('伤害');expect(input('预设卡片分类').value).toBe('damage')
  expect(document.querySelector('[aria-label="追加弹头强化"]')!.textContent).toContain('Lv2 · 15 棱晶')
  const batch=input('连续追加次数');batch.value='2';batch.dispatchEvent(new Event('change'));click('追加弹头强化')
  expect(m.state().draft.targets.map(t=>t.level)).toEqual([1,2,3]);expect(m.state().draftCost).toBe(48)
 })
 it('supports favorite filters, insertion, save/re-edit and portable import without buying',async()=>{
  const m=editor();m.actions.fresh();m.actions.name('自选顺序');m.actions.add('gun-damage');m.actions.add('gun-range');m.actions.add('gun-damage');m.actions.duplicate(0);m.actions.save()
  const saved=m.state().presets.at(-1)!;expect(saved.targets.map(t=>t.id)).toEqual(['gun-damage','gun-damage','gun-range','gun-damage'])
  m.actions.fresh();m.actions.edit(saved.id);expect(m.state().draft.targets).toEqual(saved.targets)
  const portable=readPreset(JSON.stringify(saved));await m.actions.import({size:200,text:async()=>JSON.stringify(portable)} as File)
  expect(m.state().presets.at(-1)!.targets).toEqual(saved.targets);expect(m.state().queue).toEqual([])
  const favorites=input('仅显示收藏');favorites.checked=true;favorites.dispatchEvent(new Event('change'))
  expect(document.querySelectorAll('.preset-card').length).toBe(m.state().favorites.length)
 })
})
describe('unowned automatic preferences',()=>{
 it('allows all automatic preferences before buying and exposes room/interval/off saving controls',()=>{
  const change=vi.fn(),root=renderSettingsSection({...DEFAULT_SETTINGS,autoPickup:false},{onSetting:change},PLAYER_BASE_ATTRS);document.body.append(root)
  const button=(label:string)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===label)!
  expect(button('自动索敌').disabled).toBe(false);button('自动索敌').click();expect(change).toHaveBeenLastCalledWith('aimMode','auto')
  expect(root.textContent).toContain('已预设自动');button('自动开火').click();expect(change).toHaveBeenLastCalledWith('fireMode','auto')
  button('磁铁自动吸取：关闭').click();expect(change).toHaveBeenLastCalledWith('autoPickup',true);expect(root.textContent).toContain('待购买磁吸核心')
  const mode=input('自动存档方式');expect(mode.value).toBe('room');mode.value='interval';mode.dispatchEvent(new Event('change'))
  const seconds=input('自动存档间隔秒数');expect(seconds.value).toBe('60');seconds.value='20';seconds.dispatchEvent(new Event('change'));expect(change).toHaveBeenLastCalledWith('autoSaveSeconds',20)
 })
})
