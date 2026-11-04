import { createServer, type IncomingMessage } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { decodeClient, shortText, SERVER_PROTOCOL, type ServerCommand, type ServerInfo, type RoomInfo, type ClientPacket } from '../net/serverProtocol'
import { createRemoteInput } from '../net/control'
import { createSyncEncoder } from '../net/sync'
import { readCoopSave, createCoopMatch } from '../app/modes/coop'
import { createRoom, joinRoom, disconnectRoom, removeRoomMember, transferOwner, authorize, playState, tickRoom, storedRoom, restoreRoom, roomInfo, roomSummary, cleanRoomOptions, creationAllowed, type Room } from './rooms'
import { openStore, passwordHashAsync, passwordMatchesAsync, type Identity } from './store'
import { createLanDiscovery, localAddresses } from './discovery'
export interface ServerOptions {port?:number;host?:string;dataDir:string;name?:string;createPolicy?:'open'|'key';createKey?:string;allowedOrigins?:string[];publicUrl?:string;maxRooms?:number;maxConnections?:number;staticDir?:string;discovery?:boolean;autoTick?:boolean;roomTtlMs?:number}
interface Connection {ws:WebSocket;user?:Identity;roomId?:string;input:ReturnType<typeof createRemoteInput>;encoder:ReturnType<typeof createSyncEncoder>;lastSeen:number;windowAt:number;messages:number;bytes:number;lastImport:number;lastRoom:string;inputEpoch:number;queue:Promise<void>;joinAt:number;joinCount:number}
export async function startPrismServer(options:ServerOptions) {
 const store=await openStore(options.dataDir),rooms=new Map<string,Room>(),clients=new Set<Connection>(),byUser=new Map<string,Connection>(),cache=new Map<string,string>(),droppedAt=new Map<string,number>(),registrations=new Map<string,{count:number;at:number}>()
 const policy=options.createPolicy??'key',creationKey=options.createKey??store.data.createKey,origins=new Set(options.allowedOrigins??['https://what20360.github.io'])
 const localNames=new Set(['localhost','127.0.0.1','[::1]',...localAddresses(1).map(address=>new URL(address).hostname)]);if(options.publicUrl)localNames.add(new URL(options.publicUrl).hostname)
 let closing=false,port=0,lastBroadcast=0,lastPersist=0,accumulator=0,lastTick=performance.now(),persistError=''
 for(const item of store.data.rooms){const room=restoreRoom(item);rooms.set(room.id,room);for(const member of room.members)droppedAt.set(member.userId,Date.now())}
 const info=():ServerInfo=>({protocol:SERVER_PROTOCOL,serverId:store.data.serverId,name:options.name??'PRISM 服务器',createPolicy:policy,rooms:rooms.size,version:'1.23'})
 const validHost=(req:IncomingMessage)=>{try{return localNames.has(new URL('http://'+req.headers.host).hostname)}catch{return false}}
 const validOrigin=(req:IncomingMessage)=>{const origin=req.headers.origin;if(!origin)return true;return origins.has(origin)||origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`}
 const discovery=options.discovery===false?undefined:createLanDiscovery(info,()=>port)
 const http=createServer((req,res)=>{void(async()=>{
  if(!validHost(req)){res.writeHead(403);res.end();return}
  const url=new URL(req.url??'/','http://localhost')
  if(req.headers.origin&&validOrigin(req)){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Private-Network','true')}
  if(req.method==='OPTIONS'){res.writeHead(validOrigin(req)?204:403,{'Access-Control-Allow-Methods':'GET, OPTIONS'});res.end();return}
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(url.pathname==='/api/info'||url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...info(),persistence:persistError?'error':'ok'}));return}
  if(url.pathname==='/api/discovery'){if(!discovery){res.writeHead(403);res.end('LAN discovery is disabled');return};if(!validOrigin(req)){res.writeHead(403);res.end();return};const found=await discovery?.search()??[];const self=localAddresses(port).map(address=>({serverId:info().serverId,name:info().name,address,rooms:rooms.size}));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({protocol:SERVER_PROTOCOL,servers:[...self,...found].filter((v,i,a)=>a.findIndex(x=>x.address===v.address)===i)}));return}
  if(options.staticDir){let path: string;try{const raw=decodeURIComponent(url.pathname);const relative=raw.replace(/^\/prism\//,'/');path=resolve(options.staticDir,'.'+(relative==='/'?'/index.html':relative));if(!path.startsWith(resolve(options.staticDir)+sep))throw new Error('path');const file=await stat(path);if(!file.isFile())throw new Error('path');const bytes=await readFile(path);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':extname(path)==='.html'?'no-cache':'public, max-age=3600'});res.end(bytes);return}catch{/* Fall through to the server landing page. */}}
  if(url.pathname==='/'||url.pathname==='/prism/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>PRISM 服务器</title><h1>PRISM 服务器运行中</h1><p>游戏入口：<a href="https://what20360.github.io/prism/">GitHub Pages</a>。在服务器大厅填写本服务器地址。</p><p>局域网入口需要先构建游戏：npm run build。</p>');return}
  res.writeHead(404);res.end()
 })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('服务器请求失败')})})
 const wss=new WebSocketServer({noServer:true,maxPayload:2_300_000,perMessageDeflate:{threshold:512,clientNoContextTakeover:true,serverNoContextTakeover:true,zlibDeflateOptions:{level:3},concurrencyLimit:5}})
 http.on('upgrade',(req,socket,head)=>{if(!validHost(req)||!validOrigin(req)||req.url!=='/socket'||clients.size>=(options.maxConnections??32)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req))})
 const send=(c:Connection,value:unknown)=>{if(c.ws.readyState!==WebSocket.OPEN)return false;try{c.ws.send(typeof value==='string'?value:JSON.stringify(value));return true}catch{return false}}
 const roomEvent=(c:Connection,room?:Room)=>{c.lastRoom=room?JSON.stringify(roomInfo(room)):'';c.encoder.reset();send(c,{type:'room',room:room?roomInfo(room):null})}
 const lobby=()=>{for(const c of clients)if(c.user&&!c.roomId)send(c,{type:'rooms',rooms:[...rooms.values()].filter(r=>!r.options.hidden||r.members.some(m=>m.userId===c.user!.id)).map(roomSummary)})}
 const changed=(room:Room)=>{for(const c of clients)if(c.roomId===room.id)roomEvent(c,room);lobby()}
 const persist=async()=>{store.data.rooms=[...rooms.values()].flatMap(r=>{const saved=storedRoom(r);return saved?[saved]:[]});try{await store.save();persistError=''}catch{persistError='保存失败';console.error('PRISM: 服务器进度保存失败，请检查数据目录空间与权限')}}
 const detach=(c:Connection,explicit=false)=>{const room=c.roomId?rooms.get(c.roomId):undefined;if(!room||!c.user){c.roomId=undefined;return};if(explicit)removeRoomMember(room,c.user.id);else{disconnectRoom(room,c.user.id);droppedAt.set(c.user.id,Date.now())};c.roomId=undefined;c.input.reset();if(!room.members.length)rooms.delete(room.id);changed(room);roomEvent(c);void persist()}
 const command=async(c:Connection,cmd:ServerCommand):Promise<unknown>=>{
  const user=c.user!;if(cmd.kind==='list'){send(c,{type:'rooms',rooms:[...rooms.values()].filter(r=>!r.options.hidden||r.members.some(m=>m.userId===user.id)).map(roomSummary)});return}
  if(cmd.kind==='create'){
   if(c.roomId)throw new Error('请先离开当前房间')
   if(!creationAllowed(policy,cmd.key,creationKey))throw new Error('建房授权码不正确')
   if(rooms.size>=(options.maxRooms??8)||[...rooms.values()].some(r=>r.ownerId===user.id))throw new Error('已达到房间上限，请关闭已有房间')
   const clean=cleanRoomOptions(cmd.options),hash=clean.password?await passwordHashAsync(clean.password):''
   if(byUser.get(user.id)!==c||c.ws.readyState!==WebSocket.OPEN)throw new Error('连接已被替换')
   if(rooms.size>=(options.maxRooms??8)||[...rooms.values()].some(r=>r.ownerId===user.id))throw new Error('已达到房间上限，请关闭已有房间')
   const room=createRoom(user,{...clean,password:''},Date.now());room.password=hash;while(rooms.has(room.id))room.id=createRoom(user,{...clean,password:''},Date.now()).id;rooms.set(room.id,room);c.roomId=room.id;c.input.reset();changed(room);void persist();return
  }
  if(cmd.kind==='join'){
   if(c.roomId&&c.roomId!==cmd.roomId)throw new Error('请先离开当前房间')
   const room=rooms.get(cmd.roomId);if(!room)throw new Error('房间不存在');if(Date.now()-c.joinAt>10000){c.joinAt=Date.now();c.joinCount=0};if(++c.joinCount>5)throw new Error('加入尝试过于频繁，请稍后重试');if(room.password&&!room.members.some(m=>m.userId===user.id)&&!await passwordMatchesAsync(cmd.password,room.password))throw new Error('房间密码不正确');if(byUser.get(user.id)!==c||c.ws.readyState!==WebSocket.OPEN)throw new Error('连接已被替换');joinRoom(room,user,cmd.password,false,cmd.seat,true);c.roomId=room.id;c.input.reset();droppedAt.delete(user.id);changed(room);void persist();return
  }
  if(c.roomId!==cmd.roomId)throw new Error('不能操作其他房间')
  const room=rooms.get(cmd.roomId);if(!room)throw new Error('房间已关闭');const member=authorize(room,user.id,cmd)
  room.lastActive=Date.now()
  if(cmd.kind==='leave'){detach(c,true);return}
  if(cmd.kind==='close') {for(const peer of clients)if(peer.roomId===room.id){peer.roomId=undefined;roomEvent(peer);send(peer,{type:'notice',message:'房间已由房主关闭'})}rooms.delete(room.id);lobby();void persist();return}
  if(cmd.kind==='resync'){c.encoder.reset();return}
  if(cmd.kind==='game'){const ok=room.coop?room.coop.action(member.actorId,cmd.action):room.duel!.action((member.actorId-1) as 0|1,cmd.action);if(!ok)throw new Error('操作未生效，请检查资金、前置与当前阶段');return}
  if(cmd.kind==='export'){if(!room.coop)throw new Error('1v1不提供进度存档');return room.coop.save(member.actorId)}
  if(cmd.kind==='import'){
   if(!room.coop||room.coop.started()&&!room.coop.world().paused)throw new Error('请先暂停合作房间')
   if(room.members.length!==1||Date.now()-c.lastImport<10000)throw new Error('导入时房间只能有创建者，且请勿频繁导入')
   const save=readCoopSave(JSON.stringify(cmd.save)),name=shortText(save.name);const restored=createCoopMatch(save.config,save)
   // Imports never grant arbitrary old ID bindings. Owner explicitly controls the imported host seat.
   if(save.world.coop!.members.length>1&&!room.password)throw new Error('导入多人存档前，请创建带密码的房间以保护待认领角色')
   const host=restored.hostId();room.coop=restored;room.options={...room.options,name,mode:save.config.mode,coop:save.config};room.members=restored.world().coop!.members.map(m=>m.id===host?{...member,actorId:host,ready:true}:{userId:'unclaimed:'+m.id,name:m.name,actorId:m.id,role:'player',connected:false,ready:false})
   room.roomIndex=restored.roomIndex();room.epoch++;c.lastImport=Date.now();changed(room);void persist();return
  }
  if(cmd.kind==='rename'){room.options.name=cmd.name;room.coop?.rename(cmd.name)}
  if(cmd.kind==='ready'){if(room.coop){member.ready=!member.ready;room.coop.ready(member.actorId,member.ready)}else{if(room.members.length!==2||room.members.some(m=>!m.connected))throw new Error('等待对手连接');room.duel!.ready((member.actorId-1) as 0|1);member.ready=true}}
  if(cmd.kind==='start'){if(!room.coop)throw new Error('1v1由双方准备后开始');if(!room.coop.start())throw new Error('等待所有在线成员准备，或本局已结束')}
  if(cmd.kind==='pause'){if(!room.coop)throw new Error('1v1战斗不能由玩家手动暂停');room.coop.pause()}
  if(cmd.kind==='restart'){if(room.coop)room.coop.restart();else{const mode=room.options.duelMode;room.duel=createRoom(user,{...room.options,password:'',duelMode:mode},Date.now()).duel};room.epoch++;room.roomIndex=0;room.duelRound=0;for(const m of room.members)m.ready=m.userId===room.ownerId&&Boolean(room.coop)}
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
  const c:Connection={ws,input:createRemoteInput(),encoder:createSyncEncoder(),lastSeen:Date.now(),windowAt:Date.now(),messages:0,bytes:0,lastImport:0,lastRoom:'',inputEpoch:0,queue:Promise.resolve(),joinAt:Date.now(),joinCount:0};clients.add(c)
  ws.on('pong',()=>{c.lastSeen=Date.now()})
  ws.on('error',()=>{/* Close handler owns cleanup. */})
  ws.on('message',(data,isBinary)=>{try{
   const now=Date.now();if(now-c.windowAt>1000){c.windowAt=now;c.messages=0;c.bytes=0};c.bytes+=Array.isArray(data)?data.reduce((n,b)=>n+b.byteLength,0):data.byteLength;if(++c.messages>100||c.bytes>2_350_000||isBinary)throw new Error('消息速率或格式超限')
   const packet=decodeClient(data.toString());c.lastSeen=now
   if(packet.type==='ping'){send(c,{type:'pong',time:packet.time});return}
   if(packet.type==='hello'){
    if(c.user)throw new Error('身份已经建立');if(packet.serverId&&packet.serverId!==store.data.serverId)throw new Error('服务器身份已变化，请核对地址并重新建立身份')
    if(!packet.userId){const ip=req.socket.remoteAddress??'',limit=registrations.get(ip);if(!limit||now-limit.at>600000)registrations.set(ip,{count:1,at:now});else if(++limit.count>20)throw new Error('身份申请过于频繁');if(registrations.size>2048)registrations.clear()}
    const identity=store.identify(packet.name,packet.userId,packet.token),old=byUser.get(identity.user.id);c.user=identity.user;byUser.set(c.user.id,c);if(old)old.ws.close(4001,'identity-replaced')
    send(c,{type:'welcome',info:info(),userId:c.user.id,name:c.user.name,...(identity.token?{token:identity.token}:{})})
    const room=[...rooms.values()].find(r=>r.members.some(m=>m.userId===c.user!.id)&&!r.banned.includes(c.user!.id));if(room){joinRoom(room,c.user,'',true);c.roomId=room.id;droppedAt.delete(c.user.id);changed(room)}else lobby();void persist();return
   }
   if(!c.user)throw new Error('请先建立身份')
   if(packet.type==='input'){
    if(packet.roomId!==c.roomId)return;const room=rooms.get(packet.roomId);if(!room||packet.epoch!==room.epoch)return
    const value=packet as Extract<ClientPacket,{type:'input'}>;if(c.inputEpoch!==room.epoch){c.input.reset();c.inputEpoch=room.epoch}
    c.input.accept({sequence:value.sequence,round:value.epoch,intent:value.intent,offers:value.offers},room.epoch,now);return
   }
   const active=packet
   c.queue=c.queue.then(async()=>{
    if(!c.user||byUser.get(c.user.id)!==c)return
    const key=c.user.id+':'+active.requestId,cached=cache.get(key);if(cached){send(c,cached);return}
    let result:unknown,response:unknown;try{result=await command(c,active.command);response={type:'ack',requestId:active.requestId,ok:true,...(result?{data:result}:{})}}catch(e){response={type:'ack',requestId:active.requestId,ok:false,message:e instanceof Error?e.message:'操作失败'}}
    const text=JSON.stringify(response);if(text.length<64000){cache.set(key,text);if(cache.size>1024)cache.delete(cache.keys().next().value!)}send(c,text)
   }).catch(()=>{send(c,{type:'error',message:'操作处理失败'})})
  }catch(e){send(c,{type:'error',message:e instanceof Error?e.message:'无效消息'});if(!c.user||c.messages>100)ws.close(1008,'invalid-message')}})
  ws.on('close',()=>{clients.delete(c);if(c.user&&byUser.get(c.user.id)===c){byUser.delete(c.user.id);detach(c)}})
 })
 const tick=(now=Date.now())=>{for(const room of rooms.values()){
  const inputs=new Map(room.members.filter(m=>m.connected).map(m=>{const c=byUser.get(m.userId);return [m.userId,{intent:c?.input.read(now)??{move:{x:0,y:0},fire:false},offers:c?.input.offersVisible(now)??false}]}))
  if(tickRoom(room,inputs))changed(room)
  for(const member of room.members)if(!member.connected&&now-(droppedAt.get(member.userId)??now)>60000){if(room.duel&&['countdown','fighting'].includes(room.duel.state().phase))room.duel.forfeit((member.actorId-1) as 0|1);if(room.ownerId===member.userId){const next=room.members.find(m=>m.connected&&m.role==='moderator')??room.members.find(m=>m.connected);if(next){transferOwner(room,next);changed(room)}}}
 }}
 const broadcast=(now=Date.now())=>{for(const c of clients){if(!c.user||!c.roomId||c.ws.readyState!==WebSocket.OPEN||c.ws.bufferedAmount>128*1024)continue;const room=rooms.get(c.roomId);if(!room)continue;const next=JSON.stringify(roomInfo(room));if(next!==c.lastRoom){send(c,{type:'room',room:JSON.parse(next) as RoomInfo});c.lastRoom=next};try{send(c,c.encoder.encode(playState(room,c.user.id),now))}catch{send(c,{type:'error',message:'同步失败，请离开后重试'})}}}
 const timers:ReturnType<typeof setInterval>[]=[]
 if(options.autoTick!==false)timers.push(setInterval(()=>{const now=performance.now();accumulator+=Math.min(250,now-lastTick);lastTick=now;let steps=0;while(accumulator>=1000/60&&steps++<15){tick();accumulator-=1000/60}if(now-lastBroadcast>=100){broadcast();lastBroadcast=now}if(now-lastPersist>=10000){void persist();lastPersist=now}},1000/60))
 timers.push(setInterval(()=>{const now=Date.now();for(const c of clients){if(now-c.lastSeen>20000)c.ws.terminate();else c.ws.ping()};for(const [id,r]of rooms)if(!r.members.some(m=>m.connected)&&now-r.lastActive>(options.roomTtlMs??7*86400000))rooms.delete(id);lobby()},5000))
 await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(options.port??8787,options.host??'0.0.0.0',()=>{port=(http.address() as {port:number}).port;http.off('error',reject);resolve()})});await persist()
 return {port,info,creationKey,rooms,tick,broadcast,close:async()=>{if(closing)return;closing=true;timers.forEach(clearInterval);discovery?.close();for(const c of clients)c.ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>http.close(()=>resolve()));await persist()}}
}
