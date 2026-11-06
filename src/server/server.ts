import {createAutoSaveSchedule} from '../app/autoSave'
import type {AutoSaveMode} from '../storage/config'
import { createServer, type IncomingMessage } from 'node:http'
import { sellCard } from '../core/progress'
import { silentLogger, LOG_LEVELS, type ServerLogger, type LogLevel } from './logger'
import { parseConsoleCommand, CONSOLE_HELP } from './console'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { decodeClient, shortText, SERVER_PROTOCOL, type ServerCommand, type ServerInfo, type RoomInfo } from '../net/serverProtocol'
import { createRemoteInput } from '../net/control'
import { createSyncEncoder } from '../net/sync'
import { readCoopSave, createCoopMatch } from '../app/modes/coop'
import { createRoom, joinRoom, disconnectRoom, removeRoomMember, transferOwner, authorize, playState, tickRoom, storedRoom, restoreRoom, roomInfo, roomSummary, cleanRoomOptions, creationAllowed, isWaiting, matchWorld, scheduleStart, type Room } from './rooms'
import { openStore, passwordHashAsync, passwordMatchesAsync, type Identity } from './store'
import { createLanDiscovery, localAddresses } from './discovery'
export interface ServerOptions {autoSaveMode?:AutoSaveMode;autoSaveSeconds?:number;logger?:ServerLogger;port?:number;host?:string;dataDir:string;name?:string;createPolicy?:'open'|'key';createKey?:string;allowedOrigins?:string[];publicUrl?:string;maxRooms?:number;maxConnections?:number;staticDir?:string;discovery?:boolean;autoTick?:boolean;roomTtlMs?:number}
interface Connection {id:number;receivedInputs:number;acceptedInputs:number;rejectedInputs:number;lastReject:number;bytesOut:number;ws:WebSocket;user?:Identity;roomId?:string;input:ReturnType<typeof createRemoteInput>;encoder:ReturnType<typeof createSyncEncoder>;lastSeen:number;windowAt:number;messages:number;bytes:number;lastImport:number;lastRoom:string;inputEpoch:number;queue:Promise<void>;joinAt:number;joinCount:number}
export async function startPrismServer(options:ServerOptions) {
 const logger=options.logger??silentLogger,startedAt=Date.now();let connectionId=0,inputsReceived=0,inputsRejected=0,bytesSent=0
 const log=(level:LogLevel,event:string,data:Record<string,unknown>={})=>logger.write(level,event,data)
 const store=await openStore(options.dataDir),rooms=new Map<string,Room>(),clients=new Set<Connection>(),byUser=new Map<string,Connection>(),cache=new Map<string,string>(),droppedAt=new Map<string,number>(),registrations=new Map<string,{count:number;at:number}>()
 const policy=options.createPolicy??'key',creationKey=options.createKey??store.data.createKey,origins=new Set(options.allowedOrigins??['https://what20360.github.io'])
 const localNames=new Set(['localhost','127.0.0.1','[::1]',...localAddresses(1).map(address=>new URL(address).hostname)]);if(options.publicUrl)localNames.add(new URL(options.publicUrl).hostname)
 let closing=false,port=0,lastBroadcast=0,lastPersist=0,accumulator=0,lastTick=performance.now(),persistError=''
 for(const item of store.data.rooms){const room=restoreRoom(item);rooms.set(room.id,room);for(const member of room.members)droppedAt.set(member.userId,Date.now())}
 const autoSave=createAutoSaveSchedule(),autoMode=options.autoSaveMode??'room',autoSeconds=options.autoSaveSeconds??60
 const progressKey=()=>[...rooms.values()].filter(r=>r.coop).map(r=>r.id+':'+r.epoch+':'+r.coop!.started()+':'+r.coop!.progress()).sort().join('|')||null
 const saveProgress=async()=>{const key=progressKey();if(autoSave.due(key,autoMode,autoSeconds,Date.now())){await persist();if(!persistError&&key)autoSave.saved(key,Date.now())}}
 const info=():ServerInfo=>({protocol:SERVER_PROTOCOL,serverId:store.data.serverId,name:options.name??'PRISM 服务器',createPolicy:policy,rooms:rooms.size,version:'1.28'})
 const validHost=(req:IncomingMessage)=>{try{return localNames.has(new URL('http://'+req.headers.host).hostname)}catch{return false}}
 const validOrigin=(req:IncomingMessage)=>{const origin=req.headers.origin;if(!origin)return true;return origins.has(origin)||origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`}
 const discovery=options.discovery===false?undefined:createLanDiscovery(info,()=>port)
 const http=createServer((req,res)=>{void(async()=>{
  if(!validHost(req)){log('warn','http.host_rejected');res.writeHead(403);res.end();return}
  const url=new URL(req.url??'/','http://localhost')
  if(req.headers.origin&&validOrigin(req)){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Private-Network','true')}
  if(req.method==='OPTIONS'){res.writeHead(validOrigin(req)?204:403,{'Access-Control-Allow-Methods':'GET, OPTIONS'});res.end();return}
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(url.pathname==='/api/info'||url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...info(),persistence:persistError?'error':'ok'}));return}
  if(url.pathname==='/api/discovery'){if(!discovery){log('debug','discovery.disabled');res.writeHead(403);res.end('LAN discovery is disabled');return};if(!validOrigin(req)){res.writeHead(403);res.end();return};const found=await discovery?.search()??[];const self=localAddresses(port).map(address=>({serverId:info().serverId,name:info().name,address,rooms:rooms.size}));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({protocol:SERVER_PROTOCOL,servers:[...self,...found].filter((v,i,a)=>a.findIndex(x=>x.address===v.address)===i)}));return}
  if(options.staticDir){let path: string;try{const raw=decodeURIComponent(url.pathname);const relative=raw.replace(/^\/prism\//,'/');path=resolve(options.staticDir,'.'+(relative==='/'?'/index.html':relative));if(!path.startsWith(resolve(options.staticDir)+sep))throw new Error('path');const file=await stat(path);if(!file.isFile())throw new Error('path');const bytes=await readFile(path);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':extname(path)==='.html'?'no-cache':'public, max-age=3600'});res.end(bytes);return}catch{/* Fall through to the server landing page. */}}
  if(url.pathname==='/'||url.pathname==='/prism/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>PRISM 服务器</title><h1>PRISM 服务器运行中</h1><p>游戏入口：<a href="https://what20360.github.io/prism/">GitHub Pages</a>。在服务器大厅填写本服务器地址。</p><p>局域网入口需要先构建游戏：npm run build。</p>');return}
  res.writeHead(404);res.end()
 })().catch(error=>{log('error','http.failed',{error});if(!res.headersSent)res.writeHead(500);res.end('服务器请求失败')})})
 const wss=new WebSocketServer({noServer:true,maxPayload:2_300_000,perMessageDeflate:{threshold:512,clientNoContextTakeover:true,serverNoContextTakeover:true,zlibDeflateOptions:{level:3},concurrencyLimit:5}})
 http.on('upgrade',(req,socket,head)=>{if(!validHost(req)||!validOrigin(req)||req.url!=='/socket'||clients.size>=(options.maxConnections??32)){log('warn','socket.rejected',{reason:!validHost(req)?'host':!validOrigin(req)?'origin':req.url!=='/socket'?'path':'capacity'});socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req))})
 const send=(c:Connection,value:unknown)=>{if(c.ws.readyState!==WebSocket.OPEN)return false;try{const body=typeof value==='string'?value:JSON.stringify(value);c.ws.send(body);c.bytesOut+=Buffer.byteLength(body);bytesSent+=Buffer.byteLength(body);return true}catch{return false}}
 const roomEvent=(c:Connection,room?:Room)=>{c.lastRoom=room?JSON.stringify(roomInfo(room)):'';c.encoder.reset();send(c,{type:'room',room:room?roomInfo(room):null})}
 const lobby=()=>{for(const c of clients)if(c.user&&!c.roomId)send(c,{type:'rooms',rooms:[...rooms.values()].filter(r=>!r.options.hidden||r.members.some(m=>m.userId===c.user!.id)).map(roomSummary)})}
 const changed=(room:Room)=>{for(const c of clients)if(c.roomId===room.id)roomEvent(c,room);lobby()}
 const persist=async()=>{store.data.rooms=[...rooms.values()].flatMap(r=>{const saved=storedRoom(r);return saved?[saved]:[]});try{await store.save();persistError=''}catch{persistError='保存失败';log('error','persistence.failed',{dataDir:options.dataDir})}}
 const detach=(c:Connection,explicit=false)=>{log('info',explicit?'room.left':'client.disconnected',{connection:c.id,userId:c.user?.id,roomId:c.roomId});const room=c.roomId?rooms.get(c.roomId):undefined;if(!room||!c.user){c.roomId=undefined;return};if(room.startTicks)log('info','room.countdown_cancelled',{roomId:room.id,reason:'member-left'});room.startTicks=0;if(explicit)removeRoomMember(room,c.user.id);else{disconnectRoom(room,c.user.id);droppedAt.set(c.user.id,Date.now())};c.roomId=undefined;c.input.reset();if(!room.members.length)rooms.delete(room.id);changed(room);roomEvent(c);void persist()}
 const command=async(c:Connection,cmd:ServerCommand):Promise<unknown>=>{
  const user=c.user!;if(cmd.kind==='list'){send(c,{type:'rooms',rooms:[...rooms.values()].filter(r=>!r.options.hidden||r.members.some(m=>m.userId===user.id)).map(roomSummary)});return}
  if(cmd.kind==='create'){
   if(c.roomId)throw new Error('请先离开当前房间')
   if(!creationAllowed(policy,cmd.key,creationKey))throw new Error('建房授权码不正确')
   if(rooms.size>=(options.maxRooms??8)||[...rooms.values()].some(r=>r.ownerId===user.id))throw new Error('已达到房间上限，请关闭已有房间')
   const clean=cleanRoomOptions(cmd.options),hash=clean.password?await passwordHashAsync(clean.password):''
   if(byUser.get(user.id)!==c||c.ws.readyState!==WebSocket.OPEN)throw new Error('连接已被替换')
   if(rooms.size>=(options.maxRooms??8)||[...rooms.values()].some(r=>r.ownerId===user.id))throw new Error('已达到房间上限，请关闭已有房间')
   const room=createRoom(user,{...clean,password:''},Date.now());room.password=hash;while(rooms.has(room.id))room.id=createRoom(user,{...clean,password:''},Date.now()).id;rooms.set(room.id,room);c.roomId=room.id;c.input.reset();log('info','room.created',{roomId:room.id,userId:user.id,mode:room.options.mode});changed(room);void persist();return
  }
  if(cmd.kind==='join'){
   if(c.roomId&&c.roomId!==cmd.roomId)throw new Error('请先离开当前房间')
   const room=rooms.get(cmd.roomId);if(!room)throw new Error('房间不存在');if(Date.now()-c.joinAt>10000){c.joinAt=Date.now();c.joinCount=0};if(++c.joinCount>5)throw new Error('加入尝试过于频繁，请稍后重试');if(room.password&&!room.members.some(m=>m.userId===user.id)&&!await passwordMatchesAsync(cmd.password,room.password))throw new Error('房间密码不正确');if(byUser.get(user.id)!==c||c.ws.readyState!==WebSocket.OPEN)throw new Error('连接已被替换');const previousCountdown=room.startTicks;joinRoom(room,user,cmd.password,false,cmd.seat,true);if(previousCountdown)log('info','room.countdown_cancelled',{roomId:room.id,reason:'member-joined'});c.roomId=room.id;c.input.reset();droppedAt.delete(user.id);log('info','room.joined',{roomId:room.id,userId:user.id});changed(room);void persist();return
  }
  if(c.roomId!==cmd.roomId)throw new Error('不能操作其他房间')
  const room=rooms.get(cmd.roomId);if(!room)throw new Error('房间已关闭');const member=authorize(room,user.id,cmd)
  room.lastActive=Date.now()
  if(cmd.kind==='leave'){detach(c,true);return}
  if(cmd.kind==='close') {for(const peer of clients)if(peer.roomId===room.id){peer.roomId=undefined;roomEvent(peer);send(peer,{type:'notice',message:'房间已由房主关闭'})}rooms.delete(room.id);lobby();void persist();return}
  if(cmd.kind==='resync'){c.encoder.reset();return}
  if(cmd.kind==='game'){const ok=cmd.action.kind==='sell'&&isWaiting(room)?room.options.mode==='duel'&&room.options.duelMode==='fixed'?false:sellCard(matchWorld(room),cmd.action.id,member.actorId,1):room.coop?room.coop.action(member.actorId,cmd.action):room.duel!.action((member.actorId-1) as 0|1,cmd.action);if(!ok)throw new Error('操作未生效，请检查资金、前置与当前阶段');return}
  if(cmd.kind==='export'){if(!room.coop)throw new Error('1v1不提供进度存档');return room.coop.save(member.actorId)}
  if(cmd.kind==='import'){
   if(!room.coop||room.coop.started()&&!room.coop.world().paused)throw new Error('请先暂停合作房间')
   if(room.members.length!==1||Date.now()-c.lastImport<10000)throw new Error('导入时房间只能有创建者，且请勿频繁导入')
   const save=readCoopSave(JSON.stringify(cmd.save)),name=shortText(save.name);const restored=createCoopMatch(save.config,save)
   // Imports never grant arbitrary old ID bindings. Owner explicitly controls the imported host seat.
   if(save.world.coop!.members.length>1&&!room.password)throw new Error('导入多人存档前，请创建带密码的房间以保护待认领角色')
   const host=restored.hostId();room.coop=restored;room.options={...room.options,name,mode:save.config.mode,coop:save.config};room.members=restored.world().coop!.members.map(m=>m.id===host?{...member,actorId:host,ready:true}:{userId:'unclaimed:'+m.id,name:m.name,actorId:m.id,role:'player',connected:false,ready:false})
   room.startTicks=0;room.waitingArena=undefined;room.roomIndex=restored.progress();room.epoch++;c.lastImport=Date.now();changed(room);void persist();return
  }
  if(cmd.kind==='rename'){room.options.name=cmd.name;room.coop?.rename(cmd.name)}
  if(cmd.kind==='ready'){if(!isWaiting(room)||member.userId===room.ownerId)throw new Error('只有等待大厅的队员可以准备');member.ready=!member.ready;if(!member.ready)room.startTicks=0;room.coop?.ready(member.actorId,member.ready);log('info','room.ready',{roomId:room.id,userId:user.id,ready:member.ready})}
  if(cmd.kind==='cancel-start'){room.startTicks=0;log('info','room.countdown_cancelled',{roomId:room.id,userId:user.id,reason:'manager'})}
  if(cmd.kind==='start'){scheduleStart(room);log('info','room.start_requested',{roomId:room.id,userId:user.id,countdown:Math.ceil(room.startTicks/60)})}
  if(cmd.kind==='pause'){if(!room.coop||isWaiting(room))throw new Error('只能暂停正式合作对局');room.coop.pause()}
  if(cmd.kind==='restart'){room.startTicks=0;room.waitingArena=undefined;if(room.coop)room.coop.restart();else{const mode=room.options.duelMode;room.duel=createRoom(user,{...room.options,password:'',duelMode:mode},Date.now()).duel};room.epoch++;room.roomIndex=0;room.duelRound=0;for(const m of room.members)m.ready=m.userId===room.ownerId}
  if(cmd.kind==='manage'){
   const target=room.members.find(m=>m.userId===cmd.target)!
   if(cmd.action==='promote')target.role='moderator'
   else if(cmd.action==='demote')target.role='player'
   else if(cmd.action==='transfer')transferOwner(room,target)
   else {if(cmd.action==='ban')room.banned.push(target.userId);const peer=byUser.get(target.userId);removeRoomMember(room,target.userId);if(peer?.roomId===room.id){peer.roomId=undefined;roomEvent(peer);send(peer,{type:'notice',message:cmd.action==='ban'?'已被此房间封禁':'已被移出房间'})}}
  }
  changed(room);void persist()
 }
 wss.on('connection',(ws:WebSocket,req:IncomingMessage)=>{
  const c:Connection={id:++connectionId,receivedInputs:0,acceptedInputs:0,rejectedInputs:0,lastReject:0,bytesOut:0,ws,input:createRemoteInput(),encoder:createSyncEncoder(),lastSeen:Date.now(),windowAt:Date.now(),messages:0,bytes:0,lastImport:0,lastRoom:'',inputEpoch:0,queue:Promise.resolve(),joinAt:Date.now(),joinCount:0};clients.add(c)
  log('info','client.connected',{connection:c.id,address:req.socket.remoteAddress})
  ws.on('pong',()=>{c.lastSeen=Date.now()})
  ws.on('error',error=>{log('warn','socket.error',{connection:c.id,userId:c.user?.id,error})})
  ws.on('message',(data,isBinary)=>{try{
   const now=Date.now();if(now-c.windowAt>1000){c.windowAt=now;c.messages=0;c.bytes=0};c.bytes+=Array.isArray(data)?data.reduce((n,b)=>n+b.byteLength,0):data.byteLength;if(++c.messages>100||c.bytes>2_350_000||isBinary)throw new Error('消息速率或格式超限')
   const packet=decodeClient(data.toString());c.lastSeen=now
   if(packet.type==='ping'){send(c,{type:'pong',time:packet.time});return}
   if(packet.type==='hello'){
    if(c.user)throw new Error('身份已经建立');if(packet.serverId&&packet.serverId!==store.data.serverId)throw new Error('服务器身份已变化，请核对地址并重新建立身份')
    if(!packet.userId){const ip=req.socket.remoteAddress??'',limit=registrations.get(ip);if(!limit||now-limit.at>600000)registrations.set(ip,{count:1,at:now});else if(++limit.count>20)throw new Error('身份申请过于频繁');if(registrations.size>2048)registrations.clear()}
    const identity=store.identify(packet.name,packet.userId,packet.token),old=byUser.get(identity.user.id);c.user=identity.user;byUser.set(c.user.id,c);if(old)old.ws.close(4001,'identity-replaced')
    log('info','client.authenticated',{connection:c.id,userId:c.user.id,name:c.user.name,replaced:Boolean(old)})
    send(c,{type:'welcome',info:info(),userId:c.user.id,name:c.user.name,...(identity.token?{token:identity.token}:{})})
    const room=[...rooms.values()].find(r=>r.members.some(m=>m.userId===c.user!.id)&&!r.banned.includes(c.user!.id));if(room){joinRoom(room,c.user,'',true);c.roomId=room.id;droppedAt.delete(c.user.id);changed(room)}else lobby();void persist();return
   }
   if(!c.user)throw new Error('请先建立身份')
   if(packet.type==='input'){
    inputsReceived++;c.receivedInputs++
    const room=rooms.get(packet.roomId),reason=packet.roomId!==c.roomId?'wrong-room':!room?'missing-room':packet.epoch!==room.epoch?'stale-epoch':undefined
    if(reason){inputsRejected++;c.rejectedInputs++;if(now-c.lastReject>=5000){c.lastReject=now;log('warn','input.rejected',{connection:c.id,userId:c.user.id,roomId:packet.roomId,reason})};return}
    if(c.inputEpoch!==room!.epoch){c.input.reset();c.inputEpoch=room!.epoch}
    const accepted=c.input.accept({sequence:packet.sequence,round:packet.epoch,intent:packet.intent,offers:packet.offers},room!.epoch,now)
    if(accepted){c.acceptedInputs++;if(c.acceptedInputs===1)log('info','input.receiving',{connection:c.id,userId:c.user.id,roomId:room!.id,waiting:isWaiting(room!)})}else{inputsRejected++;c.rejectedInputs++}
    return
   }
   const active=packet
   c.queue=c.queue.then(async()=>{
    if(!c.user||byUser.get(c.user.id)!==c)return
    const key=c.user.id+':'+active.requestId,cached=cache.get(key);if(cached){send(c,cached);return}
    let result:unknown,response:unknown;try{result=await command(c,active.command);response={type:'ack',requestId:active.requestId,ok:true,...(result?{data:result}:{})}}catch(e){response={type:'ack',requestId:active.requestId,ok:false,message:e instanceof Error?e.message:'操作失败'}}
    log((response as {ok:boolean}).ok?'debug':'warn',(response as {ok:boolean}).ok?'command.accepted':'command.rejected',{connection:c.id,userId:c.user.id,roomId:c.roomId,kind:active.command.kind,...(!(response as {ok:boolean}).ok?{message:(response as {message:string}).message}:{})});
    const text=JSON.stringify(response);if(text.length<64000){cache.set(key,text);if(cache.size>1024)cache.delete(cache.keys().next().value!)}send(c,text)
   }).catch(()=>{send(c,{type:'error',message:'操作处理失败'})})
  }catch(e){log('warn','protocol.rejected',{connection:c.id,userId:c.user?.id,error:e});send(c,{type:'error',message:e instanceof Error?e.message:'无效消息'});if(!c.user||c.messages>100)ws.close(1008,'invalid-message')}})
  ws.on('close',()=>{clients.delete(c);if(c.user&&byUser.get(c.user.id)===c){byUser.delete(c.user.id);detach(c)}})
 })
 const tick=(now=Date.now())=>{for(const room of rooms.values()){
  const inputs=new Map(room.members.filter(m=>m.connected).map(m=>{const c=byUser.get(m.userId);return [m.userId,{intent:c?.input.read(now)??{move:{x:0,y:0},fire:false},offers:c?.input.offersVisible(now)??false}]}))
  if(tickRoom(room,inputs)){log('info','room.phase_changed',{roomId:room.id,waiting:isWaiting(room),epoch:room.epoch});for(const c of clients)if(c.roomId===room.id){c.input.reset();c.inputEpoch=room.epoch};changed(room);void saveProgress()}
  for(const member of room.members)if(!member.connected&&now-(droppedAt.get(member.userId)??now)>60000){if(room.duel&&['countdown','fighting'].includes(room.duel.state().phase))room.duel.forfeit((member.actorId-1) as 0|1);if(room.ownerId===member.userId){const next=room.members.find(m=>m.connected&&m.role==='moderator')??room.members.find(m=>m.connected);if(next){transferOwner(room,next);changed(room)}}}
 }}
 const broadcast=(now=Date.now())=>{for(const c of clients){if(!c.user||!c.roomId||c.ws.readyState!==WebSocket.OPEN||c.ws.bufferedAmount>128*1024)continue;const room=rooms.get(c.roomId);if(!room)continue;const next=JSON.stringify(roomInfo(room));if(next!==c.lastRoom){send(c,{type:'room',room:JSON.parse(next) as RoomInfo});c.lastRoom=next};try{send(c,c.encoder.encode({...playState(room,c.user.id),inputAck:c.input.ack(now)},now))}catch(error){log('error','sync.failed',{connection:c.id,userId:c.user.id,roomId:room.id,error});send(c,{type:'error',message:'同步失败，请离开后重试'})}}}
 const inspectPlayer=(query:string)=>{
  const matches=[...byUser.entries()].filter(([id])=>id===query||id.startsWith(query));if(matches.length!==1)throw new Error(matches.length?'玩家ID前缀不唯一':'玩家不在线')
  const [userId,c]=matches[0]!;return {userId,name:c.user!.name,roomId:c.roomId,connection:c.id,received:c.receivedInputs,accepted:c.acceptedInputs,rejected:c.rejectedInputs,bytesOut:c.bytesOut,...c.input.inspect(Date.now())}
 }
 const status=()=>({version:info().version,uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),rooms:rooms.size,connections:clients.size,players:byUser.size,inputsReceived,inputsRejected,bytesSent,persistence:persistError?'error':'ok',autoSaveMode:autoMode,autoSaveSeconds:autoSeconds,logLevel:logger.getLevel()})
 const admin=async(line:string):Promise<{text:string;quit?:boolean}>=>{
  const cmd=parseConsoleCommand(line);log('info','console.command',{kind:cmd.name,...('roomId'in cmd?{roomId:cmd.roomId}:{}),...('userId'in cmd?{userId:cmd.userId}:{})})
  if(cmd.name==='help')return {text:CONSOLE_HELP}
  if(cmd.name==='status')return {text:JSON.stringify(status(),null,2)}
  if(cmd.name==='rooms')return {text:JSON.stringify([...rooms.values()].map(roomInfo),null,2)}
  if(cmd.name==='input')return {text:JSON.stringify(inspectPlayer(cmd.userId),null,2)}
  if(cmd.name==='players'){const selected=cmd.roomId?rooms.get(cmd.roomId):undefined;if(cmd.roomId&&!selected)throw new Error('房间不存在');return {text:JSON.stringify([...rooms.values()].filter(r=>!selected||r===selected).flatMap(r=>r.members.map(m=>({roomId:r.id,...m,hp:matchWorld(r).actors.get(m.actorId)?.hp}))),null,2)}}
  if(cmd.name==='save'){await persist();if(persistError)throw new Error('保存失败，请查看日志');log('info','persistence.saved');return {text:'合作进度已保存'}}
  if(cmd.name==='stop'){await persist();if(persistError)throw new Error('保存失败，未退出，请检查日志后重试');return {text:'已保存，即将退出',quit:true}}
  if(cmd.name==='log'){if(!LOG_LEVELS.includes(cmd.level as LogLevel))throw new Error('日志级别必须为debug/info/warn/error');logger.setLevel(cmd.level as LogLevel);return {text:'日志级别：'+cmd.level}}
  if(!('roomId'in cmd))throw new Error('命令缺少房间ID')
  const room=rooms.get(cmd.roomId);if(!room)throw new Error('房间不存在')
  if(cmd.name==='room')return {text:JSON.stringify({...roomInfo(room),tick:matchWorld(room).tick,entities:matchWorld(room).actors.size},null,2)}
  if(cmd.name==='start')scheduleStart(room)
  if(cmd.name==='cancel')room.startTicks=0
  if(cmd.name==='pause'){if(!room.coop||isWaiting(room))throw new Error('只能暂停正式合作对局');room.coop.pause()}
  if(cmd.name==='restart'){room.startTicks=0;room.waitingArena=undefined;if(room.coop)room.coop.restart();else room.duel=createRoom({id:room.ownerId,name:'operator',hash:'',created:0},{...room.options,password:''},Date.now()).duel;room.epoch++;room.roomIndex=0;room.duelRound=0;for(const m of room.members)m.ready=m.userId===room.ownerId}
  if(cmd.name==='close'){for(const peer of clients)if(peer.roomId===room.id){peer.roomId=undefined;peer.input.reset();roomEvent(peer);send(peer,{type:'notice',message:'服务器管理者已关闭房间'})}rooms.delete(room.id)}
  if(cmd.name==='unban'){const matches=room.banned.filter(id=>id===cmd.userId||id.startsWith(cmd.userId));if(matches.length!==1)throw new Error('封禁ID不存在或前缀不唯一');room.banned=room.banned.filter(id=>id!==matches[0])}
  if(cmd.name==='kick'||cmd.name==='ban'||cmd.name==='transfer'){
   const matches=room.members.filter(m=>m.userId===cmd.userId||m.userId.startsWith(cmd.userId));if(matches.length!==1)throw new Error('玩家不在此房间或ID前缀不唯一');const target=matches[0]!
   if(cmd.name==='transfer'){if(!target.connected)throw new Error('目标玩家不在线');transferOwner(room,target)}
   else {if(cmd.name==='ban')room.banned.push(target.userId);room.startTicks=0;removeRoomMember(room,target.userId);const peer=byUser.get(target.userId);if(peer?.roomId===room.id){peer.roomId=undefined;peer.input.reset();roomEvent(peer);send(peer,{type:'notice',message:'已被服务器管理者移出房间'})}if(!room.members.length)rooms.delete(room.id)}
  }
  changed(room);await persist();return {text:'操作完成：'+cmd.name+' '+room.id}
 }
 const timers:ReturnType<typeof setInterval>[]=[]
 if(options.autoTick!==false)timers.push(setInterval(()=>{const now=performance.now();accumulator+=Math.min(250,now-lastTick);lastTick=now;let steps=0;while(accumulator>=1000/60&&steps++<15){tick();accumulator-=1000/60}if(now-lastBroadcast>=100){broadcast();lastBroadcast=now}if(now-lastPersist>=1000){void saveProgress();lastPersist=now}},1000/60))
 timers.push(setInterval(()=>{const now=Date.now();for(const c of clients){if(now-c.lastSeen>20000)c.ws.terminate();else c.ws.ping()};for(const [id,r]of rooms)if(!r.members.some(m=>m.connected)&&now-r.lastActive>(options.roomTtlMs??7*86400000))rooms.delete(id);lobby()},5000))
 try{await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(options.port??8787,options.host??'0.0.0.0',()=>{port=(http.address() as {port:number}).port;http.off('error',reject);resolve()})})}catch(error){timers.forEach(clearInterval);discovery?.close();wss.close();log('error','server.start_failed',{port:options.port??8787,error});await logger.flush();throw error};await persist();log('info','server.listening',{version:info().version,port,rooms:rooms.size})
 return {port,info,creationKey,rooms,tick,broadcast,admin,status,inspectPlayer,close:async()=>{if(closing)return;closing=true;log('info','server.stopping');timers.forEach(clearInterval);discovery?.close();for(const c of clients)c.ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>http.close(()=>resolve()));await persist();log('info','server.stopped');await logger.flush()}}
}
