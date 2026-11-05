import type { AttrSet } from '../../core/attrs'
import { formatNumber } from '../cardInfo'
import { createAttributeModel, type AttributeBlock, type AttributeGroup } from '../attributeModel'
import { renderAttributeRadar } from '../attributeRadar'
export interface PlayerView {readonly attrs:AttrSet;readonly hp:number;readonly shield:number;readonly shieldCap:number}
const remember=(key:string,value:string)=>{try{sessionStorage.setItem('prism.attributes.'+key,value)}catch{/* optional view preference */}}
const recall=(key:string)=>{try{return sessionStorage.getItem('prism.attributes.'+key)==='true'}catch{return false}}
function group(model:AttributeGroup,blocks:AttributeBlock[]):HTMLElement {
 const section=document.createElement('section');section.className='menu__section attrs-group';section.dataset.group=model.id
 const heading=document.createElement('h3');heading.className='menu__heading';heading.textContent=model.title;section.append(heading)
 const list=document.createElement('dl');list.className='attrs__list'
 for(const block of blocks){const family=document.createElement('div');family.className='attrs__family';family.dataset.block=block.id
  for(const r of block.rows){const line=document.createElement('div');line.className='attrs__row'+(r.changed?' attrs__row--changed':'');line.dataset.attr=r.id
   const label=document.createElement('dt');label.className='attrs__key';label.textContent=r.label
   const value=document.createElement('dd');value.className='attrs__value';value.textContent=r.value
   if(r.changed){const baseline=document.createElement('small');baseline.className='attrs__baseline';baseline.textContent=`基础 ${r.base}`;value.append(baseline);label.title='当前值偏离标准基础参考，可能来自卡片、模式或临时状态。'}
   if(r.note){const hint=document.createElement('small');hint.className='attrs__note';hint.textContent=r.note;label.append(hint)}
   line.append(label,value);family.append(line)
  }list.append(family)
 }section.append(list);return section
}
/** Current-weapon sheet. Reads resolved values without mutating gameplay or saves. */
export function renderAttrsSection(view:PlayerView):HTMLElement {
 const model=createAttributeModel(view.attrs),root=document.createElement('section');root.className='attribute-sheet'
 const header=document.createElement('header');header.className='attribute-sheet__header'
 const title=document.createElement('h2');title.textContent='角色属性';const weapon=document.createElement('span');weapon.className='attribute-sheet__weapon';weapon.textContent=model.weapon
 const vitality=document.createElement('p');vitality.className='attribute-sheet__vitality';vitality.textContent=`生命 ${formatNumber(view.hp)} / ${formatNumber(view.attrs.maxHp)}`+(view.shieldCap>0?` · 护盾 ${formatNumber(view.shield)} / ${formatNumber(view.shieldCap)}`:'')
 header.append(title,weapon,vitality);root.append(header)
 const intro=document.createElement('p');intro.className='cards__intro';intro.textContent='显示当前武器及已生效机制。关键或变化的属性块优先，同类参数保持相邻；数值包含临时增益与脱战修正。';root.append(intro)
 const chartIntro=document.createElement('p');chartIntro.className='attribute-sheet__hint';chartIntro.textContent='实线为当前值，虚线为标准基础角色换装当前武器后的参考值。各轴独立缩放：50%半径对应各自参考，越接近外圈表示该轴数值越大；不代表DPS或综合战力。';root.append(chartIntro)
 const charts=document.createElement('div');charts.className='attribute-radars';charts.append(...model.radars.map(renderAttributeRadar));root.append(charts)
 const normal=document.createElement('div');normal.className='attrs';const extras=document.createElement('details');extras.className='attribute-sheet__extras';extras.open=recall('more');extras.ontoggle=()=>remember('more',String(extras.open))
 const hiddenCount=model.groups.flatMap(g=>g.blocks).filter(b=>!b.important&&!b.changed).reduce((n,b)=>n+b.rows.length,0)
 const summary=document.createElement('summary');summary.textContent=`更多基础属性 · ${hiddenCount} 项`;extras.append(summary)
 const all=document.createElement('div');all.className='attrs'
 const ordered=[...model.groups].sort((a,b)=>{
  const rank=(g:AttributeGroup)=>g.id==='offense'?0:g.blocks.some(b=>b.changed)?1:2
  return rank(a)-rank(b)
 })
 for(const g of ordered){const sorted=[...g.blocks].sort((a,b)=>Number(b.important||b.changed)-Number(a.important||a.changed)),visible=sorted.filter(b=>b.important||b.changed),hidden=sorted.filter(b=>!b.important&&!b.changed)
  if(visible.length)normal.append(group(g,visible));if(hidden.length)all.append(group(g,hidden))
 }root.append(normal);if(hiddenCount){extras.append(all);root.append(extras)}
 return root
}
