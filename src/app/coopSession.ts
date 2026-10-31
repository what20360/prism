import type { PurchaseNotice } from './purchaseQueue'
import { createCoopMatch, DEFAULT_COOP, readCoopSave, type CoopMatch, type CoopSave } from './modes/coop'
import { createDuelPeer, type DuelPeer, type PeerStatus } from '../net/peer'
import { encodeCoop, decodeCoop, type CoopPacket } from '../net/coopProtocol'
import { cleanIntent, IDLE_INPUT } from '../net/protocol'
import { restoreWorld } from '../core/serialization'
import { CARD_REGISTRY } from '../content/cards'
import { DEFAULT_ECONOMY } from '../content/economy'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { toSnapshot, toSkillView } from '../core/snapshot'
import { combatAttrs } from '../core/combat'
import { shieldCap } from '../core/attrs'
import { listCardStates } from '../core/progress'
import { SKILL_IDS, unlocked } from '../core/systems/skills'
import type { World } from '../core/world'
import type { Intent } from '../core/controller'
import type { DuelAction } from '../content/duel'
import type { PlanSession } from './planManager'
import type { createPlanManager } from './planManager'
import { readDuelIntent } from './readIntent'
import { createMenu } from '../ui/menu'
import type { IntentSource } from '../input/keyboard'
import type { PointerSource } from '../input/pointer'
import type { TouchSource } from '../input/touch'
import type { Renderer } from '../render/canvas2d/renderer'
import type { ControlSettings, SettingKey } from '../storage/config'
import { worldSeed } from './modes/endless'
type Connection={peer:DuelPeer;id?:number;connected:boolean;closed:boolean;seen:number;sequence:number;intent:Intent;inputAt:number;serial:number;window:number;messages:number;offers:boolean}
export function createCoopSession(options:{root:HTMLElement;input:IntentSource;pointer:PointerSource;touch:TouchSource;renderer:Renderer;settings:()=>ControlSettings;onSetting:<K extends SettingKey>(key:K,value:ControlSettings[K])=>void;plans:ReturnType<typeof createPlanManager>;leave:()=>void;onSnapshot?:(snapshot:ReturnType<typeof toSnapshot>,paused:boolean)=>void}) {
 let match:CoopMatch|undefined,world:World|undefined,currentSave:CoopSave|undefined,viewerId=1,role:'host'|'guest'|null=null,disposed=false,frame=0,last=0,accumulator=0,lastSend=0,lastInput=0,lastSave=0,lastCheckpoint=0,serial=0,receivedSerial=-1,sequence=0
 let pending:Connection|undefined,guest:Connection|undefined,menuOpen=false,lastUi='',lastMenu='',guestPlan:ReturnType<CoopMatch['plan']>={targets:[],enabled:false,quickMode:'planned'}
 let guestNotice:PurchaseNotice|null=null
 const connections=new Set<Connection>(),layer=document.createElement('main');layer.className='home-menu coop-lobby';layer.setAttribute('aria-label','合作房间')
 const content=document.createElement('div');content.className='home__content home__content--page';layer.append(content);options.root.append(layer)
 const title=document.createElement('h1');title.textContent='合作闯关与无尽';content.append(title)
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='创建房间或使用朋友的邀请代码加入；支持1–5人。';content.append(status)
 const setup=document.createElement('div');setup.className='practice__form';content.append(setup)
 const field=(label:string,input:HTMLElement,parent=setup)=>{const row=document.createElement('label');row.className='practice__field';row.append(document.createTextNode(label),input);parent.append(row);input.setAttribute('aria-label',label);return input}
 const select=(label:string,values:readonly (readonly [string,string])[],value:string)=>{const input=document.createElement('select');for(const [key,text]of values){const o=document.createElement('option');o.value=key;o.textContent=text;input.append(o)}input.value=value;field(label,input);return input}
 const mode=select('合作模式',[['dungeon','闯关'],['endless','无尽']],'dungeon'),difficulty=select('闯关难度',Array.from({length:7},(_,i)=>[String(i+1),String(i+1)] as const),'1')
 const resource=select('资源分配',[['equal','均分'],['killer','击杀掉落归击杀者'],['free','自由拾取'],['damage','基础份额＋伤害贡献']],'equal'),max=select('人数上限',[1,2,3,4,5].map(n=>[String(n),String(n)] as const),'5')
 mode.onchange=()=>{difficulty.disabled=mode.value==='endless'}
 const seed=document.createElement('input');seed.value='20261031';field('合作世界种子',seed)
 const name=document.createElement('input');name.value='队员';name.maxLength=24;field('队员名称',name)
 const base=document.createElement('input');base.type='number';base.min='0';base.max='100';base.value='25';field('贡献模式基础份额百分比',base)
 const pause=document.createElement('input');pause.type='checkbox';pause.checked=true;field('掉线时暂停全队',pause)
 const commands=document.createElement('div');commands.className='practice__actions';content.append(commands)
 const controls=new Map<string,HTMLButtonElement>()
 const button=(label:string,run:()=>void,parent:HTMLElement=commands)=>{const b=document.createElement('button');b.className='settings__option';b.textContent=label;b.onclick=run;parent.append(b);if(parent===commands)controls.set(label,b);return b}
 const roster=document.createElement('div');roster.setAttribute('aria-label','合作队伍');content.append(roster)
 const wire=document.createElement('div');content.append(wire)
 const invite=document.createElement('textarea');invite.readOnly=true;field('合作邀请或回应代码',invite,wire)
 const remote=document.createElement('textarea');field('对方连接代码',remote,wire)
 const note=document.createElement('p');note.textContent='每位朋友使用单独邀请。请只把代码发给本次队友。均分/贡献按基础总量分配，各自收益升级单独结算；击杀归属者离线后掉落开放。房主暂停会停止全队倒计时，个人菜单不暂停。房主离开后可从合作存档重新建房，朋友需重新连接。';content.append(note)
 const roomButton=button('队伍与合作存档',()=>{layer.hidden=!layer.hidden;menu.close();menuOpen=false},options.root);roomButton.className='coop-room-button'
 const resetInput=()=>{options.input.reset();options.pointer.reset();options.touch.reset()}
 const message=(text:string)=>{status.textContent=text}
 const sync=()=>{if(match){world=match.world();if(!currentSave||performance.now()-lastCheckpoint>=100){currentSave=match.save();lastCheckpoint=performance.now()}} }
 const persist=()=>{try{const save=match?.save(viewerId)??(currentSave?{...currentSave,hostId:viewerId}:undefined);if(save&&!save.world.gameOver&&!save.world.victory)localStorage.setItem('prism.coop.auto',JSON.stringify(save))}catch{message('合作自动存档写入失败，请导出文件备份。')}}
 const send=(c:Connection,p:CoopPacket)=>c.connected&&!c.closed&&c.peer.send(encodeCoop(p))
 const close=(c:Connection)=>{if(c.closed)return;c.closed=true;c.connected=false;c.peer.close();connections.delete(c);if(role==='host'&&c.id!==undefined)match?.disconnect(c.id)}
 const updateRoster=()=>{
  sync();
  for(const [label,b]of controls){
   if(['创建合作房间','加入合作房间','载入合作自动存档'].includes(label))b.hidden=Boolean(role)
   else if(label==='邀请新队员')b.hidden=role!=='host'||Boolean(world&&world.coop!.members.length>=world.coop!.maxPlayers)
   else if(label==='连接回应')b.hidden=role!=='host'||!pending||pending.closed||pending.connected||!invite.value
   else if(label==='复制连接代码')b.hidden=!invite.value
   else if(label==='重试加入 / 重新连接')b.hidden=role!=='guest'||Boolean(guest?.connected)
   else if(['开始 / 继续全队','暂停全队','重新开始全队'].includes(label))b.hidden=role!=='host'
   else if(label!=='离开合作房间')b.hidden=!world
  }
  file.disabled=Boolean(role);
  const signature=JSON.stringify([world?.coop?.members,world?.coop?.members.map(m=>{const a=world?.actors.get(m.id);return [a?.alive,Math.ceil(a?.hp??0),a?.attrs.maxHp]}),world?.paused,world?.gameOver,world?.victory,role]);if(signature===lastUi)return;lastUi=signature
  roster.replaceChildren();if(!world?.coop)return
  const heading=document.createElement('p');heading.textContent=`${world.victory?'全队通关':world.gameOver?'全队倒下':world.paused?'全队暂停 / 等待准备':'探索中'} · ${currentSave?.config.mode==='endless'?'无尽':'闯关'} · ${world.coop.members.filter(m=>m.connected).length}/${world.coop.maxPlayers}人 · ${({'equal':'均分','killer':'击杀掉落归属','free':'自由拾取','damage':'基础＋贡献'})[world.coop.resourceMode]} · 种子 ${currentSave?.config.seed??0}`;roster.append(heading)
  for(const m of world.coop.members){const a=world.actors.get(m.id)!,row=document.createElement('div');row.className='save-slot';row.textContent=`${m.name} #${m.id}${m.id===viewerId?'（你）':''} · ${!m.connected?'离线':!a.alive?world.gameOver?'倒地':`复活 ${(m.reviveTicks/60).toFixed(1)}秒`:`生命 ${Math.ceil(a.hp)}/${Math.round(a.attrs.maxHp)}`} · ${m.ready?'已准备':'未准备'}`;roster.append(row)
   if(role==='host'&&m.id!==viewerId){if(!m.connected)button(`重新邀请${m.name}`,()=>{void makeInvite(m.id)},row);button(`移除${m.name}`,()=>{persist();for(const c of connections)if(c.id===m.id)close(c);match?.remove(m.id);lastUi='';updateRoster()},row)}
  }
 }
 const receive=(c:Connection,text:string)=>{if(disposed||c.closed)return;try{
  const now=performance.now();if(now-c.window>1000){c.window=now;c.messages=0}if(++c.messages>120)throw new Error('消息过于频繁')
  const p=decodeCoop(text);c.seen=now
  if(p.type==='ping'){send(c,{type:'pong',time:p.time});return}if(p.type==='pong')return
  if(role==='host'&&match&&c.id!==undefined){
   if(p.type==='hello'){const m=match.world().coop!.members.find(m=>m.id===c.id)!;m.name=p.name.trim()||m.name}
   else if((p.type==='input'||p.type==='action'||p.type==='ready')&&p.sequence>c.sequence){c.sequence=p.sequence;if(p.type==='input'){c.intent=p.intent;c.inputAt=now;c.offers=p.offers!==false}else if(p.type==='action')match.action(c.id,p.action);else match.ready(c.id,p.ready)}
  }else if(role==='guest'&&p.type==='state'&&p.serial>receivedSerial){const wasPaused=world?.paused,entering=!currentSave?.started||wasPaused;guestNotice=p.notice??null;receivedSerial=p.serial;if(!currentSave)saveName.value=p.save.name;currentSave=p.save;viewerId=p.viewerId;world=restoreWorld(p.save.world,CARD_REGISTRY,DEFAULT_ECONOMY,Object.keys(PLAYER_BASE_ATTRS));guestPlan=p.save.plans[viewerId]??guestPlan;message('已同步房间。准备后等待房主开始。');if(world.paused&&!wasPaused)layer.hidden=false;if(entering&&p.save.started&&!world.paused){layer.hidden=true;setup.hidden=true}}
  updateRoster()
 }catch(error){close(c);message(error instanceof Error?error.message:'合作数据异常');if(role==='guest'){resetInput();if(world)world.paused=true;layer.hidden=false}}}
 const connection=(id?:number):Connection=>{
  const c={} as Connection
  const report=(state:PeerStatus)=>{if(disposed||c.closed)return
   if(state==='connected'){try{c.connected=true;c.seen=performance.now();if(role==='host'&&match){lastCheckpoint=0;c.id=id===undefined?match.join('队员'+(match.world().coop!.members.length+1)):match.join('',id)}else send(c,{type:'hello',name:name.value.slice(0,24)});setup.hidden=true;message('已连接，等待准备与同步。');last=0;resetInput();updateRoster()}catch(e){close(c);message(e instanceof Error?e.message:'房间已满')}}
   else if(state==='failed'||state==='disconnected'){close(c);message('连接已中断，席位保留。可由房主重新邀请；合作存档保留进度。');persist();layer.hidden=false;updateRoster()}
   else if(state==='gathering')message('正在生成连接代码……')
   else if(state==='connecting')message('正在连接队伍……')
  }
  Object.assign(c,{id,connected:false,closed:false,seen:performance.now(),sequence:-1,intent:IDLE_INPUT,inputAt:0,serial:0,window:0,messages:0,offers:true,peer:createDuelPeer({purpose:'coop',status:report,message:text=>receive(c,text)})});connections.add(c);return c
 }
 const makeInvite=async(id?:number)=>{if(role!=='host'||!match)return;try{if(pending&&!pending.connected)close(pending);pending=connection(id);const active=pending;const code=await active.peer.offer();if(!active.closed){invite.value=code;message('请将邀请发给一名队友，再粘贴其回应并连接。')}}catch(e){message(e instanceof Error?e.message:'生成邀请失败')}}
 const host=(saved?:CoopSave)=>{if(match||role){message('请先保存并离开当前房间，再创建或载入。');return;}try{const config=saved?.config??{...DEFAULT_COOP,mode:mode.value as 'dungeon'|'endless',difficulty:Number(difficulty.value) as 1,seed:worldSeed(seed.value),resourceMode:resource.value as typeof DEFAULT_COOP.resourceMode,maxPlayers:Number(max.value),baseShare:Number(base.value)/100,pauseOnDisconnect:pause.checked};match=createCoopMatch(config,saved);role='host';viewerId=match.hostId();world=match.world();world.coop!.members.find(m=>m.id===viewerId)!.name=saved?world.coop!.members.find(m=>m.id===viewerId)!.name:name.value.trim().slice(0,24)||'房主';setup.hidden=true;sync();saveName.value=saved?.name??'合作进度';updateRoster();message('房间已创建。可单人开始，或逐个邀请队友。');persist()}catch(e){message(e instanceof Error?e.message:'创建失败')}}
 button('创建合作房间',()=>host())
 button('加入合作房间',()=>{void(async()=>{try{if(role||match)throw new Error('请先离开当前房间');role='guest';guest=connection();invite.value=await guest.peer.answer(remote.value);message('请把回应代码发回房主，等待房主连接。')}catch(e){if(guest)close(guest);role=null;message(e instanceof Error?e.message:'加入失败')}})()})
 button('邀请新队员',()=>{void makeInvite()})
 button('连接回应',()=>{void pending?.peer.accept(remote.value).catch(e=>message(e instanceof Error?e.message:'回应无效'))})
 button('复制连接代码',()=>{void navigator.clipboard.writeText(invite.value).catch(()=>{invite.focus();invite.select();message('请复制已选中的代码。')})})
 button('重试加入 / 重新连接',()=>{if(role!=='guest'||guest?.connected){message('请在连接中断后重试，或先离开当前房间。');return}persist();if(guest)close(guest);guest=undefined;role=null;world=undefined;currentSave=undefined;receivedSerial=-1;sequence=0;setup.hidden=false;invite.value='';remote.value='';message('请粘贴房主为你的离线席位重新生成的邀请代码。')})
 button('准备 / 取消准备',()=>{const m=world?.coop?.members.find(m=>m.id===viewerId);if(!m)return;if(role==='host')match?.ready(viewerId,!m.ready);else if(guest)send(guest,{type:'ready',sequence:++sequence,ready:!m.ready});updateRoster()})
 button('开始 / 继续全队',()=>{if(role==='host'&&match?.start()){layer.hidden=true;resetInput();sync()}else message('仅房主可开始；首次开始需所有在线成员准备，并至少一人存活。')})
 button('暂停全队',()=>{if(role==='host'){match?.pause();sync();updateRoster();persist()}else message('全队暂停由房主操作；你的菜单不会暂停其他队员。')})
 button('重新开始全队',()=>restart())
 button('购买与角色',()=>{if(world){layer.hidden=true;menuOpen=true;menu.open('upgrade')}})
 const file=document.createElement('input');file.type='file';file.accept='.json,application/json';field('导入合作存档',file,content)
 file.onchange=()=>{const f=file.files?.[0];if(!f)return;if(f.size>2*1024*1024){message('存档不能超过2 MiB');return}void f.text().then(t=>host(readCoopSave(t))).catch(e=>message(e instanceof Error?e.message:'导入失败'))}
 button('载入合作自动存档',()=>{try{const text=localStorage.getItem('prism.coop.auto');if(!text)throw new Error('暂无合作自动存档');host(readCoopSave(text))}catch(e){message(e instanceof Error?e.message:'载入失败')}})
 const saveName=document.createElement('input');saveName.value='合作进度';saveName.maxLength=40;field('合作存档名称',saveName,content)
 button('保存并导出合作存档',()=>{if(!world||world.gameOver||world.victory){message('暂无可继续的合作进度');return}match?.rename(saveName.value);persist();const save=match?.save(viewerId)??(currentSave?{...currentSave,hostId:viewerId,name:saveName.value.trim()||currentSave.name}:undefined);if(!save)return;const url=URL.createObjectURL(new Blob([JSON.stringify(save)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`PRISM_合作_${save.name.replace(/[\\/:*?"<>|]/g,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('已保存并导出合作进度。')})
 button('离开合作房间',()=>{persist();options.leave()})
 const panelState=()=>{const a=world!.actors.get(viewerId)!,p=world!.participants![viewerId]!;return {shards:p.shards,cards:listCardStates(world!,viewerId),player:{attrs:combatAttrs(a),hp:a.hp,shield:a.shield,shieldCap:shieldCap(a.attrs)},settings:options.settings(),skillSlots:[...a.skillSlots],knownSkills:SKILL_IDS.filter(id=>unlocked(a.attrs,id)).map(id=>toSkillView(a,id))}}
 const action=(a:DuelAction)=>{if(!world||!world.coop?.members.find(m=>m.id===viewerId)?.connected)return false;const ok=role==='host'?match!.action(viewerId,a):guest?send(guest,{type:'action',sequence:++sequence,action:a}):false;if(ok&&a.kind==='buy'){if(a.id==='auto-aim')options.onSetting('aimMode','auto');if(a.id==='auto-fire')options.onSetting('fireMode','auto')}sync();menu.refresh();return ok}
 const build:PlanSession={panelState,plan:()=>match?structuredClone(match.plan(viewerId)):structuredClone(guestPlan),setPlan:targets=>action({kind:'plan',targets:[...targets]}),setAutoBuy:enabled=>{action({kind:'auto',enabled})},setQuickMode:mode=>{action({kind:'quick-mode',mode})},moveQueued:(index,direction)=>{action({kind:'move',index,direction})},removeQueued:index=>{action({kind:'remove',index})},queueUpgrade:(id,level)=>action({kind:'queue',id,level})}
 const restart=()=>{if(role!=='host'){menu.close();menuOpen=false;layer.hidden=false;message('只有房主可以重新开始全队。');return}persist();match?.restart();currentSave=undefined;sync();menu.close();menuOpen=false;layer.hidden=false;message('已重开本局，席位保留，请队友重新准备。');updateRoster()}
 const menu=createMenu(options.root,{homeLabel:'返回合作房间',getState:panelState,onClose:()=>{menuOpen=false;menu.close();resetInput()},onRestart:restart,onHome:()=>{menuOpen=false;menu.close();layer.hidden=false;updateRoster()},onBuy:id=>{action({kind:'buy',id})},onSell:id=>{action({kind:'sell',id})},onEquip:(slot,id)=>{action({kind:'equip',slot,id})},onSetting:options.onSetting,onPractice:()=>{},favorites:options.plans.favorites,onFavorite:options.plans.actions.favorite,plans:options.plans.actions,getPlans:options.plans.state,onQueue:id=>{action({kind:'queue',id})}})
 const toggle=()=>{if(!world){layer.hidden=false;return}if(menuOpen){menuOpen=false;menu.close()}else{layer.hidden=true;menuOpen=true;menu.open('upgrade')}resetInput()}
 const loop=(now:number)=>{if(disposed)return;if(options.input.consumeMenuToggle())toggle();if(options.input.consumeRestart()&&(world?.gameOver||world?.victory))restart();const elapsed=last?Math.min(0.25,(now-last)/1000):0;last=now
  for(const c of connections)if(c.connected&&!c.closed&&now-c.seen>15000){close(c);message('队员响应超时，已按离线处理。');if(role==='guest'){if(world)world.paused=true;layer.hidden=false}}
  if(role==='host'&&match){accumulator+=elapsed;while(accumulator>=1/60){const inputs=new Map<number,Intent>();match.showOffers(viewerId,!menuOpen&&layer.hidden);inputs.set(viewerId,!menuOpen&&layer.hidden?cleanIntent(readDuelIntent(toSnapshot(match.world(),viewerId),options.input,options.pointer,options.touch,options.renderer,options.settings())):IDLE_INPUT);for(const c of connections)if(c.id!==undefined&&c.connected&&!c.closed){inputs.set(c.id,now-c.inputAt<300?c.intent:IDLE_INPUT);match.showOffers(c.id,c.offers&&now-c.inputAt<300)};match.tick(inputs);accumulator-=1/60}sync();if(now-lastSend>100){for(const c of connections)if(c.connected&&!c.closed&&c.id!==undefined&&currentSave?.world.coop?.members.some(m=>m.id===c.id))send(c,{type:'state',serial:++serial,viewerId:c.id,save:{...currentSave!,hostId:c.id},notice:match.notice(c.id)});lastSend=now}}
  else if(role==='guest'&&guest?.connected&&world&&now-lastInput>33){send(guest,{type:'input',sequence:++sequence,offers:!menuOpen&&layer.hidden,intent:!menuOpen&&layer.hidden&&!world.paused?cleanIntent(readDuelIntent(toSnapshot(world,viewerId),options.input,options.pointer,options.touch,options.renderer,options.settings())):IDLE_INPUT});lastInput=now}
  if(world){const signature=JSON.stringify(world.participants?.[viewerId]);if(signature!==lastMenu&&menu.visible&&['upgrade','attrs','skills'].includes(menu.section)&&!document.activeElement?.matches('input,textarea,select')){menu.refresh();lastMenu=signature}const snap=toSnapshot(world,viewerId);options.renderer.draw(snap,{fps:elapsed?1/elapsed:0,label:`${world.paused?'全队暂停 · ':''}合作 ${world.coop!.members.filter(m=>m.connected).length}人 · ${currentSave?.config.mode==='endless'?`无尽 ${currentSave?.endless?.floor??1}`:`闯关 ${Math.floor((currentSave?.roomIndex??0)/5)+1}`}`});options.touch.update(snap,menuOpen||!layer.hidden||world.paused||!world.actors.get(viewerId)?.alive);options.onSnapshot?.(snap,world.paused);if(world.gameOver||world.victory){layer.hidden=false;updateRoster()}}
  if(!layer.hidden)updateRoster();if(now-lastSave>10000){persist();lastSave=now}frame=requestAnimationFrame(loop)
 }
 const visibility=()=>{if(document.hidden&&role==='host'){match?.pause();sync();persist()}}
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',persist)
 resetInput();frame=requestAnimationFrame(loop)
 return {toggleMenu:toggle,refresh:()=>{menu.refresh();lastUi='';updateRoster()},build:()=>world?build:undefined,cards:()=>world?listCardStates(world,viewerId):[],buy:(id:string)=>action({kind:'buy',id}),active:()=>Boolean(world&&!world.paused&&!world.gameOver&&!world.victory&&layer.hidden&&!menuOpen),notice:()=>match?match.notice(viewerId):guestNotice,dispose:()=>{if(disposed)return;persist();disposed=true;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',persist);cancelAnimationFrame(frame);for(const c of connections)close(c);menu.dispose();layer.remove();roomButton.remove();resetInput()}}
}
