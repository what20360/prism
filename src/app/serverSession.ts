import { clientId } from '../storage/clientId'
import type { IntentSource } from '../input/keyboard'
import type { PointerSource } from '../input/pointer'
import type { TouchSource } from '../input/touch'
import type { Renderer } from '../render/canvas2d/renderer'
import type { ControlSettings, SettingKey } from '../storage/config'
import type { PlanSession, createPlanManager } from './planManager'
import { createMenu, type MenuState } from '../ui/menu'
import { CARD_REGISTRY } from '../content/cards'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { shieldCap } from '../core/attrs'
import { listBuildCards } from '../core/progress'
import { readDuelIntent } from './readIntent'
import { DEFAULT_COOP } from './modes/coop'
import { worldSeed } from './modes/endless'
import { SERVER_PROTOCOL, socketAddress, httpAddress, parseJson, type ServerInfo, type RoomInfo, type RoomSummary, type ServerCommand, type RoomOptions, type PlayState } from '../net/serverProtocol'
import { createSyncDecoder, createSnapshotInterpolator } from '../net/sync'
import { IDLE_INPUT } from '../net/control'
import type { Intent } from '../core/controller'
import type { DuelAction } from '../content/duel'
interface Identity {serverId:string;userId:string;token:string}
interface Pending {packet:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void;at:number;generation:number}
interface Options {root:HTMLElement;input:IntentSource;pointer:PointerSource;touch:TouchSource;renderer:Renderer;settings:()=>ControlSettings;onSetting:<K extends SettingKey>(key:K,value:ControlSettings[K])=>void;plans:ReturnType<typeof createPlanManager>;leave:()=>void;onSnapshot?:(snapshot:PlayState['snapshot'],paused:boolean)=>void}

function saveFile(name:string,value:unknown):void {const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function storageRead(key:string):string|null {try{return localStorage.getItem(key)}catch{return null}}
function storageWrite(key:string,value:string):void {try{localStorage.setItem(key,value)}catch{/* Session identity still works; offer backup. */}}
export function createServerSession(options:Options) {
 let disposed=false,ws:WebSocket|undefined,info:ServerInfo|undefined,identity:Identity|undefined,endpoint='',room:RoomInfo|undefined,state:PlayState|undefined,connected=false,manualClose=false,generation=0,networkGeneration=0,retry=0,sequence=0,lastSeen=0,lastInput=0,lastSent='',lastPing=0,frame=0,lobbyOpen=true,menuOpen=false,lastMenu='',lastRefresh=0,resultOpen=false
 let retryTimer:ReturnType<typeof setTimeout>|undefined,handshakeTimer:ReturnType<typeof setTimeout>|undefined
 const pending=new Map<string,Pending>(),decoder=createSyncDecoder(),interpolator=createSnapshotInterpolator()
 const layer=document.createElement('main');layer.className='home-menu server-lobby';layer.setAttribute('aria-label','服务器与局域网');options.root.append(layer)
 const content=document.createElement('div');content.className='home__content home__content--page';layer.append(content)
 const title=document.createElement('h1');title.textContent='服务器与局域网';content.append(title)
 const toast=document.createElement('p');toast.className='server__toast';toast.setAttribute('role','status');toast.hidden=true;options.root.append(toast);let toastUntil=0
 const status=document.createElement('p');status.className='server__status';status.setAttribute('role','status');content.append(status)
 const download=document.createElement('a');download.href='https://what20360.github.io/prism/server/PRISM_server.zip?v=1.26';download.textContent='下载服务器程序（Node.js 22+）';download.className='server__download';content.append(download)
 const note=document.createElement('p');note.className='settings__hint';note.textContent='连接服务器后选择房间。身份自动保存在此浏览器；房主只负责管理房间，战斗由服务器运行。';content.append(note)
 const stage=document.createElement('aside');stage.className='server-stage';stage.setAttribute('role','status');stage.hidden=true;options.root.append(stage)
 const startButton=document.createElement('button');startButton.className='server-start-button settings__option';startButton.textContent='开始对局（5秒倒计时）';startButton.hidden=true;startButton.onclick=()=>current(room?.ownerId===identity?.userId?'start':'ready');options.root.append(startButton)
 const result=document.createElement('section');result.className='panel panel--result server-result';result.setAttribute('role','dialog');result.setAttribute('aria-label','联机对局结算');result.hidden=true;options.root.append(result)
 const setup=document.createElement('section');setup.className='server__setup practice__form';content.append(setup)
 const field=(label:string,input:HTMLElement,parent=setup)=>{const wrap=document.createElement('label');wrap.className='practice__field';wrap.append(document.createTextNode(label),input);parent.append(wrap);input.setAttribute('aria-label',label);return input}
 const text=(label:string,value='',parent=setup,type='text')=>{const input=document.createElement('input');input.type=type;input.value=value;input.autocomplete='off';field(label,input,parent);return input}
 const select=(label:string,values:readonly (readonly [string,string])[],value:string,parent=setup)=>{const input=document.createElement('select');for(const [key,label]of values){const option=document.createElement('option');option.value=key;option.textContent=label;input.append(option)}input.value=value;field(label,input,parent);return input}
 const button=(label:string,action:()=>void,parent:HTMLElement=content)=>{const b=document.createElement('button');b.type='button';b.className='settings__option';b.textContent=label;b.onclick=action;parent.append(b);return b}
 const address=text('服务器地址',storageRead('prism.server.address')??(location.protocol==='http:'?location.origin:''));address.placeholder='https://game.example.com 或 http://192.168.1.20:8787'
 const playerName=text('玩家名称',storageRead('prism.server.name')??'玩家');playerName.maxLength=24
 const connectButton=button('连接服务器',()=>{manualClose=false;void connect(false)},setup)
 const gateway=text('局域网发现入口',location.protocol==='http:'?location.origin:'http://localhost:8787')
 const searchButton=button('搜索局域网服务器',()=>{void searchLan()},setup)
 const lanNote=document.createElement('p');lanNote.className='settings__hint';lanNote.textContent='搜索需本机运行服务器程序，或填写同网段服务器地址作为发现入口。请按浏览器提示允许局域网访问；其他设备也可直接输入服务器IP。';content.append(lanNote)
 const discoveries=document.createElement('div');discoveries.className='server__rooms';content.append(discoveries)
 const credentials=document.createElement('div');credentials.className='practice__actions';content.append(credentials)
 const identityLabel=document.createElement('p');identityLabel.className='server__identity';credentials.append(identityLabel)
 button('备份玩家身份',()=>{if(!identity){message('连接服务器后可备份身份');return}saveFile('PRISM_身份_'+identity.userId.slice(-8)+'.json',{format:'prism-identity',version:1,address:endpoint,...identity})},credentials)
 const identityImport=document.createElement('input');identityImport.type='file';identityImport.accept='.json,application/json';field('恢复玩家身份',identityImport,credentials)
 identityImport.onchange=()=>{const file=identityImport.files?.[0];if(!file)return;if(file.size>4096){message('身份文件过大');return}void file.text().then(async value=>{const d=parseJson(value,4096) as {format?:string;version?:number;address?:string;serverId?:string;userId?:string;token?:string};if(d.format!=='prism-identity'||d.version!==1||typeof d.token!=='string'||typeof d.userId!=='string'||typeof d.serverId!=='string'||!d.address)throw new Error('身份备份无效');if(connected)throw new Error('请先断开服务器再恢复身份');const origin=httpAddress(d.address).origin;storageWrite('prism.identity:'+origin,JSON.stringify({serverId:d.serverId,userId:d.userId,token:d.token}));address.value=origin;message('身份已恢复，点击连接服务器')}).catch(e=>message(e.message))}
 const lobby=document.createElement('section');lobby.hidden=true;content.append(lobby)
 const heading=document.createElement('h2');heading.textContent='可以加入的房间';lobby.append(heading)
 const joinForm=document.createElement('div');joinForm.className='practice__form';lobby.append(joinForm)
 const roomCode=text('房间ID（含未公开房间）','',joinForm),joinPassword=text('加入密码','',joinForm,'password'),seat=text('恢复存档角色编号（可选）','',joinForm);seat.inputMode='numeric'
 button('按ID加入',()=>join(roomCode.value),joinForm);button('刷新房间列表',()=>{void request({kind:'list'}).catch(report)},joinForm)
 const list=document.createElement('div');list.className='server__rooms';lobby.append(list)
 const create=document.createElement('details');create.className='server__create';lobby.append(create);const summary=document.createElement('summary');summary.textContent='创建新房间';create.append(summary)
 const createForm=document.createElement('div');createForm.className='practice__form';create.append(createForm)
 const roomName=text('房间名称','朋友的房间',createForm),mode=select('联机模式',[['dungeon','合作闯关'],['endless','合作无尽'],['duel','1v1']],'dungeon',createForm),duelMode=select('1v1规则',[['fixed','固定装备'],['budget','限额构筑'],['resource','资源争夺']],'budget',createForm)
 const seed=text('世界种子','20261104',createForm),difficulty=select('闯关难度',Array.from({length:7},(_,i)=>[String(i+1),String(i+1)] as const),'1',createForm),capacity=select('房间人数上限',[1,2,3,4,5].map(n=>[String(n),String(n)] as const),'5',createForm)
 const resources=select('资源分配',[['equal','均分'],['killer','击杀者拾取'],['free','自由拾取'],['damage','基础份额＋伤害占比']],'equal',createForm),share=text('贡献模式基础份额百分比','25',createForm);share.type='number';share.min='0';share.max='100'
 const pause=document.createElement('input');pause.type='checkbox';pause.checked=true;field('成员掉线时暂停合作对局',pause,createForm)
 const hidden=document.createElement('input');hidden.type='checkbox';field('不公开房间（凭房间ID加入）',hidden,createForm)
 const password=text('房间密码（可选）','',createForm,'password'),createKey=text('建房授权码','',createForm,'password');createKey.autocomplete='off'
 mode.onchange=()=>{duelMode.disabled=mode.value!=='duel';capacity.disabled=mode.value==='duel';difficulty.disabled=mode.value!=='dungeon';resources.disabled=mode.value==='duel'};mode.onchange(new Event('change'))
 button('创建房间',()=>{const selected=mode.value as RoomOptions['mode'];void request({kind:'create',key:createKey.value,options:{name:roomName.value,mode:selected,duelMode:duelMode.value as RoomOptions['duelMode'],password:password.value,hidden:hidden.checked,coop:{...DEFAULT_COOP,mode:selected==='endless'?'endless':'dungeon',seed:worldSeed(seed.value),difficulty:Number(difficulty.value) as 1,maxPlayers:Number(capacity.value),resourceMode:resources.value as typeof DEFAULT_COOP.resourceMode,baseShare:Number(share.value)/100,pauseOnDisconnect:pause.checked}}}).catch(report)},createForm)
 const roomPanel=document.createElement('section');roomPanel.className='server__room';roomPanel.hidden=true;content.append(roomPanel)
 const toolbar=document.createElement('div');toolbar.className='practice__actions';content.append(toolbar)
 button('断开服务器',()=>disconnect(),toolbar);button('返回主菜单',()=>options.leave(),toolbar)
 const roomButton=button('房间与队伍',()=>{lobbyOpen=true;menuOpen=false;menu.close();updateVisibility()},options.root);roomButton.className='server-room-button'
 const resetInput=()=>{options.input.reset();options.pointer.reset();options.touch.reset();lastSent=''}
 const message=(text:string)=>{status.textContent=text;toast.textContent=text;toastUntil=performance.now()+5000;toast.hidden=!layer.hidden}
 const report=(error:unknown)=>message(error instanceof Error?error.message:'操作失败')
 function send(value:unknown):boolean {if(ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>128*1024)return false;ws.send(JSON.stringify(value));return true}
 function request(command:ServerCommand):Promise<unknown> {return new Promise((resolve,reject)=>{if(!connected){reject(new Error('请先连接服务器'));return};const requestId=clientId(),packet=JSON.stringify({protocol:SERVER_PROTOCOL,type:'command',requestId,command});pending.set(requestId,{packet,resolve,reject,at:Date.now(),generation});ws!.send(packet)})}
 function current(kind:'leave'|'ready'|'cancel-start'|'start'|'pause'|'restart'|'export'|'close'):void {if(!room)return;const target=room;void request({kind,roomId:target.id,epoch:target.epoch}).then(value=>{if(kind==='export'&&value)saveFile('PRISM_合作_'+target.name.replace(/[\\/:*?"<>|]/g,'_')+'.json',value)}).catch(report)}
 const gameAction=(action:DuelAction):boolean=>{if(!room||!state||!connected)return false;void request({kind:'game',roomId:room.id,epoch:room.epoch,action}).catch(report);return true}
 function join(id:string):void {const code=id.trim().toUpperCase();void request({kind:'join',roomId:code,password:joinPassword.value,...(seat.value?{seat:Number(seat.value)}:{})}).then(()=>{joinPassword.value=''}).catch(report)}
 function updateVisibility():void {layer.hidden=!lobbyOpen;if(layer.hidden&&document.activeElement instanceof HTMLElement&&document.activeElement.closest('.server-lobby'))document.activeElement.blur();updateStage();roomPanel.hidden=!room;lobby.hidden=!connected||Boolean(room);roomButton.hidden=!room;connectButton.disabled=connected;identityImport.disabled=connected;address.disabled=connected;playerName.disabled=connected}
 function renderRooms(rooms:RoomSummary[]):void {list.replaceChildren();if(!rooms.length){const p=document.createElement('p');p.textContent='暂无公开房间，可以创建房间或输入房间ID。';list.append(p)}for(const r of rooms){const card=document.createElement('article');card.className='server__room-card';const title=document.createElement('strong');title.textContent=`${r.name} · ${r.id}`;const description=document.createElement('p');description.textContent=`${r.mode==='duel'?'1v1':r.mode==='endless'?'合作无尽':'合作闯关'} · ${r.count}/${r.capacity}人 · ${r.running?'进行中':'等待大厅 / 暂停'}${r.locked?' · 需要密码':''}`;card.append(title,description);button('加入 '+r.id,()=>join(r.id),card);list.append(card)}}
 function renderRoom():void {
  roomPanel.replaceChildren();if(!room)return
  const currentRoom=room,self=currentRoom.members.find(m=>m.userId===identity?.userId),manager=self?.role==='owner'||self?.role==='moderator'
  const h=document.createElement('h2');h.textContent=currentRoom.name+' · '+currentRoom.id;roomPanel.append(h)
  const hint=document.createElement('p');hint.textContent=`${currentRoom.waiting?currentRoom.startCountdown?'倒计时 '+currentRoom.startCountdown+'秒':'等待大厅 · 可测试构筑，原价退卡':currentRoom.running?'进行中':'已暂停 / 已结束'} · ${currentRoom.count}/${currentRoom.capacity}人 · ${currentRoom.mode==='duel'?'由管理者发起倒计时':currentRoom.config.pauseOnDisconnect?'掉线暂停已开启':'掉线后继续战斗'}${currentRoom.hidden?' · 未公开':''}`;roomPanel.append(hint)
  const team=document.createElement('div');roomPanel.append(team)
  for(const m of currentRoom.members){const row=document.createElement('div');row.className='server__member';const label=document.createElement('span');label.textContent=`${m.name} · ${m.userId} · 角色#${m.actorId} · ${({owner:'房主',moderator:'管理员',player:'玩家'})[m.role]} · ${m.connected?currentRoom.waiting?m.userId===currentRoom.ownerId?'房主':m.ready?'已准备':'未准备':'在线':'离线'}`;row.append(label)
   const manage=(action:'kick'|'ban'|'promote'|'demote'|'transfer')=>{void request({kind:'manage',roomId:currentRoom.id,epoch:currentRoom.epoch,target:m.userId,action}).catch(report)}
   if(manager&&m!==self&&m.role!=='owner'&&(self?.role==='owner'||m.role==='player')){button('移出 '+m.name,()=>manage('kick'),row);button('封禁 '+m.name,()=>manage('ban'),row);if(self?.role==='owner'){button(m.role==='moderator'?'撤销管理员 '+m.name:'设为管理员 '+m.name,()=>manage(m.role==='moderator'?'demote':'promote'),row);if(m.connected)button('转让房主给 '+m.name,()=>manage('transfer'),row)}}team.append(row)
  }
  if(manager){const rename=text('房间与存档名称',currentRoom.name,roomPanel);button('保存房间名称',()=>{void request({kind:'rename',roomId:currentRoom.id,epoch:currentRoom.epoch,name:rename.value}).catch(report)},roomPanel)}
  const actions=document.createElement('div');actions.className='practice__actions';roomPanel.append(actions)
  if(self?.userId!==currentRoom.ownerId&&currentRoom.waiting)button(self?.ready?'取消准备':'准备',()=>current('ready'),actions)
  if(manager){if(currentRoom.startCountdown)button('取消开始倒计时',()=>current('cancel-start'),actions);else button(currentRoom.waiting?'开始对局（5秒倒计时）':'继续对局',()=>current('start'),actions);if(!currentRoom.waiting&&currentRoom.mode!=='duel')button('暂停全队',()=>current('pause'),actions)}
  if(manager)button('重新开始对局',()=>current('restart'),actions)
  button(currentRoom.waiting?'返回等待大厅':'返回战场',()=>{if(!state){message('等待首个游戏快照');return}lobbyOpen=false;resetInput();updateVisibility()},actions)
  button('购买与角色',()=>{if(state){lobbyOpen=false;menuOpen=true;menu.open('upgrade');updateVisibility()}},actions)
  if(currentRoom.mode!=='duel'){
   button('导出合作存档',()=>current('export'),actions)
   if(self?.role==='owner'){const file=document.createElement('input');file.type='file';file.accept='.json,application/json';field('导入合作存档（仅创建者在房内时）',file,roomPanel);file.onchange=()=>{const f=file.files?.[0];if(!f)return;if(f.size>2*1024*1024){message('存档不能超过2MiB');return}void f.text().then(text=>request({kind:'import',roomId:currentRoom.id,epoch:currentRoom.epoch,save:parseJson(text)})).catch(report)}}
  }
  button('离开房间',()=>current('leave'),actions)
  if(self?.role==='owner')button('关闭房间',()=>current('close'),actions)
 }
 function updateStage():void {
  const self=room?.members.find(m=>m.userId===identity?.userId)
  stage.hidden=lobbyOpen||menuOpen||resultOpen||!state||!room||!(state.waiting||state.paused)
  stage.textContent=state?.startCountdown?`${state.startCountdown} 秒后开始 · 可继续测试和调整构筑`:state?.waiting?'等待大厅 · 队员准备后由房主开始 · 训练不计收益 · 原价退卡':state?.paused?'对局已暂停 · 请由管理者继续':''
  stage.classList.toggle('server-stage--countdown',Boolean(state?.startCountdown))
  startButton.hidden=lobbyOpen||menuOpen||resultOpen||!state?.waiting||!self||Boolean(state.startCountdown&&self.userId===room?.ownerId)
  const owner=self?.userId===room?.ownerId,unready=room?.members.filter(m=>m.connected&&m.userId!==room?.ownerId&&!m.ready).length??0
  startButton.textContent=owner?`开始对局（5秒倒计时）${unready?' · 等待'+unready+'人准备':''}`:self?.ready?'取消准备':'准备'
  startButton.disabled=Boolean(owner&&unready);startButton.title=owner&&unready?'需要所有在线队员准备完成':''
 }
 function showSettlement():void {
  if(!state||!room)return;resultOpen=true;lobbyOpen=false;menuOpen=false;menu.close();resetInput();result.replaceChildren()
  const title=document.createElement('h1');title.className='result__title';title.textContent=state.mode==='duel'?state.duel?.phase==='finished'?'比赛结束':'本回合结束':state.snapshot.victory?'远征完成':'全队阵亡';result.append(title)
  const hint=document.createElement('p');hint.className='result__subtitle';hint.textContent=state.mode==='duel'?`比分 ${state.duel!.wins.join(' : ')} · 可返回等待大厅调整构筑`:'战场已保留，可以查看战场或返回房间。';result.append(hint)
  const stats=document.createElement('dl');stats.className='result__grid';for(const [key,value]of [['击败敌人',String(state.snapshot.stats.kills)],['战斗时长',Math.floor(state.snapshot.tick/60)+'秒'],['剩余棱晶',Math.floor(state.snapshot.shards).toString()]]){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=key!;detail.textContent=value!;stats.append(term,detail)}result.append(stats)
  const dismiss=()=>{resultOpen=false;result.hidden=true;updateVisibility()}
  button(state.waiting?'返回等待大厅':'查看战场',()=>{lobbyOpen=false;dismiss()},result)
  button('返回房间',()=>{lobbyOpen=true;dismiss()},result)
  const self=room.members.find(m=>m.userId===identity?.userId);if(self?.role==='owner'||self?.role==='moderator')button('重开并回到等待大厅',()=>{current('restart')},result)
  result.hidden=false;updateVisibility()
 }
 function panelState():MenuState {if(!state)return {shards:0,cards:[],player:{attrs:PLAYER_BASE_ATTRS,hp:0,shield:0,shieldCap:0},settings:options.settings(),skillSlots:[null,null],knownSkills:[]};const a=state.snapshot.actors.find(a=>a.local)??state.snapshot.actors[0]!;return {refundRatio:state.waiting?1:undefined,shards:state.snapshot.shards,cards:listBuildCards(CARD_REGISTRY,state.attrs,{shards:state.snapshot.shards,purchases:state.purchases},state.restrictions,state.waiting?1:undefined),player:{attrs:state.attrs,hp:a.hp,shield:a.shield,shieldCap:shieldCap(state.attrs)},settings:options.settings(),skillSlots:a.skills.map(s=>s.id),knownSkills:state.knownSkills}}
 const build:PlanSession={panelState,plan:()=>state?.plan??{enabled:false,targets:[]},setPlan:targets=>gameAction({kind:'plan',targets:[...targets]}),setAutoBuy:enabled=>{gameAction({kind:'auto',enabled})},setQuickMode:mode=>{gameAction({kind:'quick-mode',mode})},moveQueued:(index,direction)=>{gameAction({kind:'move',index,direction})},removeQueued:index=>{gameAction({kind:'remove',index})},queueUpgrade:(id,level)=>gameAction({kind:'queue',id,level})}
 const menu=createMenu(options.root,{homeLabel:'返回房间',hideSections:['saves'],getState:panelState,onClose:()=>{menuOpen=false;menu.close();resetInput()},onRestart:()=>current('restart'),onHome:()=>{menuOpen=false;menu.close();lobbyOpen=true;updateVisibility()},onBuy:id=>{gameAction({kind:'buy',id})},onSell:id=>{gameAction({kind:'sell',id})},onEquip:(slot,id)=>{gameAction({kind:'equip',slot,id})},onSetting:(key,value)=>{options.onSetting(key,value);menu.refresh()},onPractice:()=>{},favorites:options.plans.favorites,onFavorite:options.plans.actions.favorite,plans:options.plans.actions,getPlans:options.plans.state,onQueue:id=>{gameAction({kind:'queue',id})}})
 function toggleMenu():void {if(resultOpen)return;if(!state||!room){lobbyOpen=true;updateVisibility();return};if(menuOpen){menuOpen=false;menu.close()}else{lobbyOpen=false;menuOpen=true;menu.open('upgrade')};resetInput();updateVisibility()}
 async function serverFetch(url:URL):Promise<unknown> {const response=await fetch(url,{signal:AbortSignal.timeout(4000),cache:'no-store',...({targetAddressSpace:/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)?url.hostname==='localhost'||url.hostname.startsWith('127.')?'loopback':'local':undefined})});if(!response.ok)throw new Error('服务器响应 '+response.status);const text=await response.text();return parseJson(text,64000)}
 async function searchLan():Promise<void> {searchButton.disabled=true;discoveries.replaceChildren();message('正在通过发现入口搜索局域网……');try{const url=httpAddress(gateway.value);url.pathname='/api/discovery';const result=await serverFetch(url) as {protocol?:string;servers?:{address:string;name:string}[]};if(result.protocol!==SERVER_PROTOCOL||!Array.isArray(result.servers)||result.servers.length>64)throw new Error('发现入口不是兼容的PRISM服务器');for(const s of result.servers){const origin=httpAddress(s.address).origin;button(s.name+' · '+origin,()=>{if(connected){message('请先断开当前服务器');return}address.value=origin;message('地址已填写，点击连接服务器')},discoveries)}message(result.servers.length?`找到${result.servers.length}个服务器地址`:'未发现服务器；请检查是否在同一网络、服务器发现功能和防火墙设置')}catch{message('无法访问发现入口。请先在本机运行服务器程序，或输入同网段服务器IP；若浏览器阻止访问，可直接打开局域网服务器提供的游戏入口。')}finally{searchButton.disabled=false}}
 function disconnect():void {manualClose=true;networkGeneration++;clearTimeout(retryTimer);clearTimeout(handshakeTimer);if(connected&&room)current('leave');connected=false;ws?.close();ws=undefined;room=undefined;state=undefined;info=undefined;identity=undefined;generation++;for(const p of pending.values())p.reject(new Error('连接已断开'));pending.clear();decoder.reset();interpolator.reset();menu.close();menuOpen=false;resultOpen=false;result.hidden=true;lobbyOpen=true;resetInput();identityLabel.textContent='';message('已断开服务器');updateVisibility()}
 async function connect(reconnecting:boolean):Promise<void> {
  if(disposed)return;const ticket=++networkGeneration;clearTimeout(retryTimer);clearTimeout(handshakeTimer);if(!reconnecting){generation++;ws?.close();room=undefined;state=undefined;decoder.reset();interpolator.reset()}
  connected=false;connectButton.disabled=true;address.disabled=true;playerName.disabled=true;identityImport.disabled=true;message(reconnecting?'正在恢复连接与席位……':'正在连接服务器……')
  try {
   const base=httpAddress(address.value);endpoint=base.origin;const url=new URL('/api/info',base);const fetched=await serverFetch(url) as ServerInfo;if(ticket!==networkGeneration||disposed)return
   if(fetched.protocol!==SERVER_PROTOCOL||typeof fetched.serverId!=='string')throw new Error('服务器协议不兼容')
   info=fetched;const stored=storageRead('prism.identity:'+endpoint);identity=stored?JSON.parse(stored) as Identity:undefined
   if(identity&&identity.serverId!==info.serverId)throw new Error('此地址的服务器身份已变化；请核对服务器或使用新的地址')
   const socket=new WebSocket(socketAddress(endpoint));ws=socket
   handshakeTimer=setTimeout(()=>{if(!connected&&socket===ws)socket.close()},7000)
   socket.onopen=()=>{if(ticket!==networkGeneration||disposed)return;send({protocol:SERVER_PROTOCOL,type:'hello',name:playerName.value.trim()||'玩家',...(identity??{}),serverId:info!.serverId})}
   socket.onmessage=event=>{if(ticket!==networkGeneration||disposed||typeof event.data!=='string')return;lastSeen=performance.now();try{const packet=parseJson(event.data) as Record<string,unknown>
    if(packet.type==='welcome'){
     clearTimeout(handshakeTimer);if(typeof packet.userId!=='string'||!/^P-[a-f0-9-]{36}$/.test(packet.userId)||!(typeof packet.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(packet.token)||identity?.token))throw new Error('服务器身份响应无效');connected=true;retry=0;identity={serverId:info!.serverId,userId:String(packet.userId),token:typeof packet.token==='string'?packet.token:identity!.token};storageWrite('prism.identity:'+endpoint,JSON.stringify(identity));storageWrite('prism.server.address',endpoint);storageWrite('prism.server.name',playerName.value);identityLabel.textContent=`${info!.name} · 玩家ID ${identity.userId}`;message('连接成功，请选择或创建房间');decoder.reset();sequence=0;lastSent='';updateVisibility();for(const p of pending.values())if(p.generation===generation)socket.send(p.packet);return
    }
    if(packet.type==='rooms'){renderRooms(packet.rooms as RoomSummary[]);return}
    if(packet.type==='room'){const next=packet.room as RoomInfo|null;const reset=room?.id!==next?.id||room?.epoch!==next?.epoch;const starting=next?.running&&!room?.running,enteringWaiting=next?.waiting&&(next.id!==room?.id||!room?.waiting);room=next??undefined;if((starting||enteringWaiting)&&!menuOpen)lobbyOpen=false;if(reset){decoder.reset();interpolator.reset();state=undefined;sequence=0;resultOpen=false;result.hidden=true;resetInput()};if(!room){lobbyOpen=true;menu.close();menuOpen=false;resultOpen=false;result.hidden=true;state=undefined};renderRoom();updateVisibility();return}
    if(packet.type==='sync'){
     let next:PlayState|null;try{next=decoder.apply(packet)}catch{if(room)void request({kind:'resync',roomId:room.id,epoch:room.epoch}).catch(()=>{});return};if(next){const finished=(next.duel?.phase==='round-over'||next.duel?.phase==='finished'||next.snapshot.gameOver||next.snapshot.victory)&&!(state?.duel?.phase==='round-over'||state?.duel?.phase==='finished'||state?.snapshot.gameOver||state?.snapshot.victory);const phaseChanged=state?.waiting!==next.waiting;state=next;if(finished)showSettlement();updateStage();interpolator.push(state.snapshot,performance.now());if(state.duel)status.textContent=(`${state.label} · ${state.duel.phase==='fighting'?`剩余${Math.ceil(state.duel.remaining/60)}秒`:state.duel.phase==='countdown'?'即将开始':state.duel.phase==='finished'?'比赛结束':'等待管理者开始'} · ${state.duel.wins.join(' : ')}`);if(menuOpen){const signature=JSON.stringify([state.waiting,state.purchases,state.attrs,state.snapshot.shards,state.plan,state.knownSkills]);if(phaseChanged||signature!==lastMenu&&performance.now()-lastRefresh>250&&!document.activeElement?.matches('input,textarea,select')){menu.refresh();lastMenu=signature;lastRefresh=performance.now()}}};return
    }
    if(packet.type==='ack'){const p=pending.get(String(packet.requestId));if(p){pending.delete(String(packet.requestId));if(packet.ok)p.resolve(packet.data);else p.reject(new Error(String(packet.message??'操作失败')))};return}
    if(packet.type==='error'||packet.type==='notice')message(String(packet.message))
   }catch{message('服务器消息无效，请检查双方版本')}}
   socket.onerror=()=>{/* Close owns the retry path. */}
   socket.onclose=event=>{if(ticket!==networkGeneration||disposed)return;connected=false;clearTimeout(handshakeTimer);resetInput();lobbyOpen=true;menuOpen=false;menu.close();updateVisibility();if(event.code===4001){manualClose=true;message('此身份已在另一个页面连接，已停止自动重连');return};if(event.code===1008){manualClose=true;message('身份或协议被服务器拒绝，请核对身份备份和版本');return};if(!manualClose){message('连接中断，正在自动重连；原席位保留');retryTimer=setTimeout(()=>{void connect(true)},Math.min(8000,1000*2**retry++))}}
  }catch(error){if(ticket!==networkGeneration||disposed)return;connectButton.disabled=false;updateVisibility();report(new Error(`${error instanceof Error?error.message:'连接失败'}。局域网连接如受浏览器限制，可打开服务器的 http://IP:端口 游戏入口。`));if(reconnecting&&!manualClose)retryTimer=setTimeout(()=>{void connect(true)},Math.min(8000,1000*2**retry++))}
 }
 const frameLoop=(now:number)=>{if(disposed)return;toast.hidden=lobbyOpen||now>toastUntil
  if(options.input.consumeMenuToggle())toggleMenu();if(options.input.consumeRestart()&&state&&(state.snapshot.gameOver||state.snapshot.victory))current('restart')
  if(connected&&room&&state){if(now-lastInput>=33){const intent:Intent=!menuOpen&&!lobbyOpen&&!resultOpen&&!document.hidden&&!state.paused&&!state.snapshot.gameOver&&!state.snapshot.victory?readDuelIntent(interpolator.read(now)??state.snapshot,options.input,options.pointer,options.touch,options.renderer,options.settings()):IDLE_INPUT;const signature=JSON.stringify([intent,!menuOpen&&!lobbyOpen&&!resultOpen&&!document.hidden]);if(signature!==lastSent||now-lastInput>=100){send({protocol:SERVER_PROTOCOL,type:'input',roomId:room.id,epoch:room.epoch,sequence:++sequence,intent,offers:!menuOpen&&!lobbyOpen&&!resultOpen&&!document.hidden});lastSent=signature;lastInput=now}}
   const snapshot=interpolator.read(now)??state.snapshot;options.renderer.draw(snapshot,{fps:60,label:state.label,duel:state.mode==='duel'});options.touch.update(snapshot,menuOpen||lobbyOpen||resultOpen||state.paused);options.onSnapshot?.(snapshot,state.paused)
  }
  if(connected&&now-lastPing>5000){send({protocol:SERVER_PROTOCOL,type:'ping',time:Math.round(Date.now())});lastPing=now}
  if(connected&&now-lastSeen>20000)ws?.close()
  for(const [id,p]of pending)if(Date.now()-p.at>30000){pending.delete(id);p.reject(new Error('操作响应超时，请检查房间状态'))}
  frame=requestAnimationFrame(frameLoop)
 }
 const visibility=()=>{if(document.hidden){resetInput();if(connected&&room)send({protocol:SERVER_PROTOCOL,type:'input',roomId:room.id,epoch:room.epoch,sequence:++sequence,intent:IDLE_INPUT,offers:false})}}
 document.addEventListener('visibilitychange',visibility);updateVisibility();message('输入服务器地址连接，或通过局域网发现入口搜索');frame=requestAnimationFrame(frameLoop)
 return {toggleMenu,refresh:()=>{if(menu.visible)menu.refresh()},build:()=>state&&connected?build:undefined,active:()=>Boolean(state&&connected&&!state.paused&&!menuOpen&&!lobbyOpen&&!resultOpen&&!state.snapshot.gameOver&&!state.snapshot.victory),notice:()=>state?.notice??null,cards:()=>state?panelState().cards:[],buy:(id:string)=>gameAction({kind:'buy',id}),dispose:()=>{disposed=true;manualClose=true;clearTimeout(retryTimer);clearTimeout(handshakeTimer);cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);ws?.close();for(const p of pending.values())p.reject(new Error('已离开服务器'));pending.clear();menu.dispose();layer.remove();roomButton.remove();toast.remove();stage.remove();startButton.remove();result.remove();resetInput()}}
}
