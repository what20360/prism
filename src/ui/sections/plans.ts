import type {BuildPreset,UpgradeTarget,QuickMode} from '../../app/upgradePlans'
import {CARD_GROUPS,cardCategoryLabel} from '../../content/cardLayout'
import {CARD_REGISTRY} from '../../content/cards'
export interface PresetView extends BuildPreset {readonly id:string}
export interface PlanView {
 readonly canUse:boolean;readonly cards:readonly {id:string;name:string;level:number;category:string;tags:readonly string[];firstPrice:number;maxLevel?:number}[]
 readonly draftCost:number;readonly presets:readonly PresetView[];readonly draft:BuildPreset;readonly editing:boolean;readonly message:string
 readonly queue:readonly {id:string;name:string;level:number;current:number;price:number;status:string}[];readonly enabled:boolean
 readonly favorites:readonly string[];readonly quickMode:QuickMode
}
export interface PlansHandlers {
 name(value:string):void;target(index:number,level:number):void;add(id:string,count?:number,requirements?:boolean):void;duplicate(index:number):void;moveTarget(index:number,direction:-1|1):void;favorite(id:string):void;mode(mode:QuickMode):void
 save():void;capture():void;fresh():void;edit(id:string):void;apply(id:string):void;export(id:string):void;import(file:File):void
 toggle(enabled:boolean):void;move(index:number,direction:-1|1):void;remove(index:number):void;queue(id:string,level:number):void
}
const remember=(key:string,value:string)=>{try{sessionStorage.setItem('prism.preset.'+key,value)}catch{/* optional editor preference */}}
const recall=(key:string,fallback:string)=>{try{return sessionStorage.getItem('prism.preset.'+key)??fallback}catch{return fallback}}
export function renderPlansSection(state:PlanView,actions:PlansHandlers):HTMLElement {
 const root=document.createElement('section');root.className='plans-page'
 const text=(tag:string,value:string,parent:HTMLElement=root,cls='')=>{const node=document.createElement(tag);node.textContent=value;node.className=cls;parent.append(node);return node}
 const button=(parent:HTMLElement,label:string,run:()=>void,disabled=false)=>{const node=document.createElement('button');node.type='button';node.className='settings__option';node.textContent=label;node.onclick=run;node.disabled=disabled;parent.append(node);return node}
 text('h2','升级预设与预购');text('p','点选卡片按顺序追加，可搜索名称或基础标签。同一张卡可以反复加入；列表上方先购买，已有等级会跳过。',root,'cards__intro')
 const status=text('p',state.message,root,'save-status');status.setAttribute('role','status')
 const toolbar=text('div','',root,'preset-toolbar');button(toolbar,'新建预设',actions.fresh);button(toolbar,'使用当前构筑',actions.capture,!state.canUse)
 const upload=document.createElement('input');upload.type='file';upload.accept='.json,application/json';upload.hidden=true;upload.setAttribute('aria-label','导入升级预设文件');upload.onchange=()=>{const file=upload.files?.[0];if(file)actions.import(file);upload.value=''};toolbar.append(upload);button(toolbar,'导入升级预设',()=>upload.click())
 const collection=document.createElement('details');collection.className='preset-library';root.append(collection);text('summary',`保存的预设 · ${state.presets.length}`,collection)
 for(const preset of state.presets){const row=text('article','',collection,'save-slot');text('h4',preset.name,row);text('p',preset.targets.slice(0,8).map(t=>`${state.cards.find(c=>c.id===t.id)?.name??t.id} Lv${t.level}`).join(' → ')+(preset.targets.length>8?' …':''),row,'settings__hint');button(row,`载入${preset.name}预购`,()=>actions.apply(preset.id),!state.canUse);button(row,`编辑${preset.name}`,()=>actions.edit(preset.id));button(row,`导出${preset.name}`,()=>actions.export(preset.id))}
 text('h3',state.editing?'编辑预设':'新预设')
 const nameLabel=text('label','预设名称',root,'plan-field'),name=document.createElement('input');name.type='text';name.maxLength=40;name.value=state.draft.name;name.setAttribute('aria-label','预设名称');name.oninput=()=>actions.name(name.value);nameLabel.append(name)
 const savebar=text('div','',root,'preset-toolbar');text('span',`${state.draft.targets.length} 项 · 从零购买预计 ${Math.ceil(state.draftCost)} 棱晶`,savebar);button(savebar,state.editing?'保存预设修改':'保存新预设',actions.save)
 const editor=text('div','',root,'preset-editor'),catalog=text('section','',editor,'preset-catalog'),sequence=text('section','',editor,'preset-sequence')
 catalog.setAttribute('aria-label','预设卡片目录');sequence.setAttribute('aria-label','预设购卡顺序')
 text('h4','选择卡片',catalog)
 const search=document.createElement('input');search.type='search';search.placeholder='搜索名称、标签或分类';search.value=recall('query','');search.setAttribute('aria-label','搜索预设卡片');catalog.append(search)
 const category=document.createElement('select');category.setAttribute('aria-label','预设卡片分类');for(const [value,label]of [['all','全部分类'],...CARD_GROUPS.map(g=>[g.id,g.label])]){const option=document.createElement('option');option.value=value!;option.textContent=label!;category.append(option)}category.value=recall('category','all');if(!category.value)category.value='all';catalog.append(category)
 const check=(label:string,key:string,initial:boolean)=>{const wrap=text('label','',catalog,'preset-check'),input=document.createElement('input');input.type='checkbox';input.checked=recall(key,String(initial))==='true';input.setAttribute('aria-label',label);wrap.append(input,document.createTextNode(label));return input}
 const favorites=check('仅显示收藏','favorites',false),requirements=check('自动补齐卡片前置','requirements',true)
 requirements.onchange=()=>remember('requirements',String(requirements.checked))
 const batchLabel=text('label','连续追加次数',catalog,'plan-field'),batch=document.createElement('input');batch.type='number';batch.min='1';batch.max='50';batch.step='1';batch.value=recall('count','1');batch.setAttribute('aria-label','连续追加次数');batch.onchange=()=>{batch.value=String(Math.max(1,Math.min(50,Math.round(Number(batch.value)||1))));remember('count',batch.value)};batchLabel.append(batch)
 const choices=text('div','',catalog,'preset-card-list');choices.onscroll=()=>remember('scroll',String(choices.scrollTop))
 const renderCatalog=()=>{
  choices.replaceChildren();const query=search.value.trim().toLocaleLowerCase(),seen=new Map(state.draft.targets.map(t=>[t.id,t.level]))
  const cards=state.cards.filter(c=>(category.value==='all'||c.category===category.value)&&(!favorites.checked||state.favorites.includes(c.id))&&`${c.name} ${c.tags.join(' ')} ${cardCategoryLabel(c.category)}`.toLocaleLowerCase().includes(query))
  for(const c of cards){const next=(seen.get(c.id)??0)+1,full=c.maxLevel!==undefined&&next>c.maxLevel,b=button(choices,'',()=>actions.add(c.id,Number(batch.value)||1,requirements.checked),full);b.className='preset-card';b.setAttribute('aria-label',`追加${c.name}`);text('strong',c.name,b);text('span',`${c.tags.join(' · ')} · ${full?'已达最高等级':`下一项 Lv${next} · ${CARD_REGISTRY.get(c.id)!.priceFn(next)} 棱晶`}`,b)}
  if(!cards.length)text('p','没有符合筛选的卡片。',choices,'settings__hint')
 }
 search.oninput=()=>{remember('query',search.value);renderCatalog()};category.onchange=()=>{remember('category',category.value);renderCatalog()};favorites.onchange=()=>{remember('favorites',String(favorites.checked));renderCatalog()};renderCatalog()
 queueMicrotask(()=>{if(root.isConnected)choices.scrollTop=Number(recall('scroll','0'))||0})
 text('h4','购卡优先顺序',sequence);text('p','↑↓调整先后；“再加一级”在此处插入同卡下一等级，并顺延后续等级。',sequence,'settings__hint')
 const list=text('ol','',sequence,'preset-steps')
 for(const [index,target]of state.draft.targets.entries()){
  const card=state.cards.find(c=>c.id===target.id)!,row=text('li','',list,'preset-step');text('strong',`${index+1}. ${card.name}`,row)
  const level=document.createElement('input');level.type='number';level.min='1';level.step='1';level.value=String(target.level);level.setAttribute('aria-label',`第${index+1}项${card.name}目标等级`);level.onchange=()=>actions.target(index,Number(level.value));row.append(level)
  const controls=text('div','',row,'preset-step__actions');button(controls,`上移第${index+1}项`,()=>actions.moveTarget(index,-1),index===0);button(controls,`下移第${index+1}项`,()=>actions.moveTarget(index,1),index===state.draft.targets.length-1);button(controls,`再加一级第${index+1}项`,()=>actions.duplicate(index),card.maxLevel!==undefined);button(controls,`移除第${index+1}项${card.name}`,()=>actions.target(index,0))
 }
 if(!state.draft.targets.length)text('p','从卡片目录点选，建立第一步。',sequence,'settings__hint')
 text('h3','预购队列');button(root,`自动购买：${state.enabled?'开启':'关闭'}`,()=>actions.toggle(!state.enabled),!state.canUse)
 const queue=text('ol','',root,'plan-queue');for(const [index,item]of state.queue.entries()){const row=text('li','',queue);text('span',`${item.name} Lv${item.current} → Lv${item.level} · 下一级 ${item.price} 棱晶 · ${index?'排队中':item.status}`,row);button(row,`上移${item.name}`,()=>actions.move(index,-1),index===0);button(row,`下移${item.name}`,()=>actions.move(index,1),index===state.queue.length-1);button(row,`移除${item.name}`,()=>actions.remove(index))}
 if(!state.queue.length)text('p','队列为空，可载入预设或在升级面板选择预购。',root,'settings__hint')
 text('h3','快捷购买方式');for(const [mode,label]of [['favorites','收藏卡片'],['planned','流派提示']] as const){const b=button(root,label,()=>actions.mode(mode));b.setAttribute('aria-pressed',String(state.quickMode===mode))}
 text('p','流派提示按队列依次出现；自动购买需提示满3秒。选择收藏方式时暂停流派自动购买。',root,'settings__hint')
 const favoriteEditor=document.createElement('details');root.append(favoriteEditor);text('summary',`编辑收藏 · ${state.favorites.length}`,favoriteEditor)
 const favoriteList=text('div','',favoriteEditor,'favorite-editor');for(const card of state.cards){const active=state.favorites.includes(card.id),b=button(favoriteList,`${active?'★':'☆'} ${card.name}`,()=>actions.favorite(card.id));b.setAttribute('aria-label',`${active?'取消收藏':'收藏'}${card.name}`);b.setAttribute('aria-pressed',String(active))}
 return root
}
export type {UpgradeTarget}
