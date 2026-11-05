import { radarRatio, type AttributeRadar, type RadarAxis } from './attributeModel'
import { formatNumber } from './cardInfo'
const NS='http://www.w3.org/2000/svg'
export const radarValue=(axis:RadarAxis,n=axis.value)=>axis.unit==='%'?`${formatNumber(n*100)}%`:`${formatNumber(n)}${axis.unit}`
/** SVG scales with its container. Exact data is also available as ordinary text. */
export function renderAttributeRadar(radar:AttributeRadar):HTMLElement {
 const figure=document.createElement('figure');figure.className='attribute-radar';figure.dataset.radar=radar.id
 const heading=document.createElement('figcaption');heading.textContent=radar.title;figure.append(heading)
 const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 400 320');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${radar.title}雷达图`)
 const element=(tag:string,attrs:Record<string,string>,text?:string,parent:Element=svg)=>{const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;parent.append(node);return node}
 element('title',{},`${radar.title}：当前构筑与标准基础参考`)
 element('desc',{},radar.axes.map(a=>`${a.label} ${radarValue(a)}，基础 ${radarValue(a,a.base)}`).join('；')+'。各轴独立缩放，不代表DPS或综合战力。')
 const angle=(i:number)=>-Math.PI/2+i*2*Math.PI/radar.axes.length
 const point=(i:number,r:number)=>[200+Math.cos(angle(i))*r,151+Math.sin(angle(i))*r]
 const polygon=(r:(i:number)=>number)=>radar.axes.map((_,i)=>point(i,r(i)).map(n=>n.toFixed(2)).join(',')).join(' ')
 for(const ratio of [0.25,0.5,0.75,1])element('polygon',{points:polygon(()=>87*ratio),class:'attribute-radar__grid'+(ratio===0.5?' attribute-radar__grid--middle':'')})
 radar.axes.forEach((_,i)=>{const [x,y]=point(i,87);element('line',{x1:'200',y1:'151',x2:String(x),y2:String(y),class:'attribute-radar__spoke'})})
 element('polygon',{points:polygon(i=>87*radarRatio(radar.axes[i]!.base,radar.axes[i]!.scale)),class:'attribute-radar__base'})
 element('polygon',{points:polygon(i=>87*radarRatio(radar.axes[i]!.value,radar.axes[i]!.scale)),class:'attribute-radar__current'})
 radar.axes.forEach((axis,i)=>{
  const [x,y]=point(i,87*radarRatio(axis.value,axis.scale)),[tx,ty]=point(i,116)
  const circle=element('circle',{cx:String(x),cy:String(y),r:'3.5',class:'attribute-radar__point'});element('title',{},`${axis.label}：${radarValue(axis)}；基础${radarValue(axis,axis.base)}；50%半径参考${radarValue(axis,axis.scale)}`,circle)
  const label=element('text',{x:String(tx),y:String(ty),class:'attribute-radar__label','text-anchor':Math.cos(angle(i))>0.25?'start':Math.cos(angle(i))< -0.25?'end':'middle'})
  element('tspan',{x:String(tx)},axis.label,label);element('tspan',{x:String(tx),dy:'17',class:'attribute-radar__value'},radarValue(axis),label)
 })
 figure.append(svg)
 const legend=document.createElement('p');legend.className='attribute-radar__legend'
 for(const [cls,text]of [['current','● 当前'],['base','┄ 基础参考']]){const span=document.createElement('span');span.className='attribute-radar__legend-'+cls;span.textContent=text!;legend.append(span)}figure.append(legend)
 const note=document.createElement('p');note.className='attribute-radar__note';note.textContent=radar.note;figure.append(note)
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='数值与标尺';details.append(summary)
 try{details.open=sessionStorage.getItem('prism.attributes.radar.'+radar.id)==='true'}catch{/* optional view preference */}
 details.ontoggle=()=>{try{sessionStorage.setItem('prism.attributes.radar.'+radar.id,String(details.open))}catch{/* optional view preference */}}
 const table=document.createElement('table');table.className='attribute-radar__table'
 const tr=document.createElement('tr');for(const text of ['属性','当前','基础','50%参考']){const th=document.createElement('th');th.scope='col';th.textContent=text;tr.append(th)}const thead=document.createElement('thead');thead.append(tr);table.append(thead)
 const tbody=document.createElement('tbody');for(const axis of radar.axes){const row=document.createElement('tr');for(const text of [axis.label,radarValue(axis),radarValue(axis,axis.base),radarValue(axis,axis.scale)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell)}tbody.append(row)}table.append(tbody);details.append(table);figure.append(details)
 return figure
}
