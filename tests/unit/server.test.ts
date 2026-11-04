import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import dgram from 'node:dgram'
import WebSocket from 'ws'
import {startPrismServer} from '../../src/server/server'
import {SERVER_PROTOCOL,decodeClient,socketAddress,httpAddress,type ServerCommand,type RoomOptions,type RoomInfo} from '../../src/net/serverProtocol'
import {DEFAULT_COOP,createCoopMatch} from '../../src/app/modes/coop'
import {createSyncDecoder} from '../../src/net/sync'
import {passwordHash,passwordMatches,openStore} from '../../src/server/store'
import {createLanDiscovery,DISCOVERY_PORT} from '../../src/server/discovery'
const cleanup:(()=>Promise<unknown>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
async function server(extra:Partial<Parameters<typeof startPrismServer>[0]>={}){const dir=await mkdtemp(join(tmpdir(),'prism-server-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const s=await startPrismServer({dataDir:dir,port:0,host:'127.0.0.1',discovery:false,autoTick:false,createKey:'private-create-key',...extra});cleanup.push(()=>s.close());return {s,dir,url:`http://127.0.0.1:${s.port}`}}
interface Packet {type:string;[key:string]:unknown}
async function client(url:string,identity?:{userId:string;token:string;serverId:string},name='队员'){
 const ws=new WebSocket(url.replace('http','ws')+'/socket',{origin:'https://what20360.github.io',perMessageDeflate:true}),messages:Packet[]=[],waiters:{predicate:(p:Packet)=>boolean;resolve:(p:Packet)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[]
 ws.on('error',()=>{});ws.on('message',data=>{const p=JSON.parse(data.toString()) as Packet;const index=waiters.findIndex(w=>w.predicate(p));if(index>=0){const w=waiters.splice(index,1)[0]!;clearTimeout(w.timer);w.resolve(p)}else messages.push(p)})
 const wait=(predicate:(p:Packet)=>boolean):Promise<Packet>=>{const index=messages.findIndex(predicate);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]!);return new Promise((resolve,reject)=>{const row={predicate,resolve,reject,timer:setTimeout(()=>{const i=waiters.indexOf(row);if(i>=0)waiters.splice(i,1);reject(new Error('packet timeout: '+messages.map(p=>p.type).join(',')))},4000)};waiters.push(row)})}
 await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})
 ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'hello',name,...identity}));const welcome=await wait(p=>p.type==='welcome')
 const id={userId:String(welcome.userId),token:String(welcome.token??identity?.token),serverId:(welcome.info as {serverId:string}).serverId}
 const command=async(command:ServerCommand,requestId:string=crypto.randomUUID())=>{const promise=wait(p=>p.type==='ack'&&p.requestId===requestId);ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'command',requestId,command}));return promise}
 const close=()=>new Promise<void>(resolve=>{if(ws.readyState===WebSocket.CLOSED){resolve();return}ws.once('close',()=>resolve());ws.close()})
 cleanup.push(close);return {ws,wait,command,identity:id,close,messages}
}
const options=(extra:Partial<RoomOptions>={}):RoomOptions=>({name:'朋友的房间',mode:'dungeon',duelMode:'budget',coop:{...DEFAULT_COOP,pauseOnDisconnect:false},password:'',hidden:false,...extra})
async function create(c:Awaited<ReturnType<typeof client>>,o=options()){const ack=await c.command({kind:'create',options:o,key:'private-create-key'});expect(ack.ok,ack.message as string).toBe(true);return (await c.wait(p=>p.type==='room'&&Boolean(p.room))).room as RoomInfo}
const scoped=(room:RoomInfo,kind:'start'|'ready'|'pause'|'restart'|'leave'|'export'|'close')=>({kind,roomId:room.id,epoch:room.epoch})
describe('authoritative server rooms over real WebSockets',()=>{
 it('enforces the room limit after concurrent asynchronous password hashing',async()=>{
  const {s,url}=await server({maxRooms:1}),a=await client(url),b=await client(url)
  const responses=await Promise.all([a,b].map(c=>c.command({kind:'create',options:options({password:'friends'}),key:'private-create-key'})))
  expect(responses.filter(r=>r.ok)).toHaveLength(1);expect(s.rooms.size).toBe(1)
 })
 it('protects room creation, lists rooms and enforces passwords and room capacity',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),outsider=await client(url)
  expect((await a.command({kind:'create',options:options(),key:'wrong'})).ok).toBe(false);expect(s.rooms.size).toBe(0)
  const room=await create(a,options({password:'friends',coop:{...DEFAULT_COOP,maxPlayers:2}}))
  await b.command({kind:'list'});expect(((await b.wait(p=>p.type==='rooms'&&(p.rooms as {id:string}[]).some(r=>r.id===room.id))).rooms as {locked:boolean}[])[0]!.locked).toBe(true)
  expect((await b.command({kind:'join',roomId:room.id,password:'wrong'})).ok).toBe(false)
  expect((await b.command({kind:'join',roomId:room.id,password:'friends'})).ok).toBe(true)
  expect((await outsider.command({kind:'join',roomId:room.id,password:'friends'})).ok).toBe(false)
  expect((await outsider.command(scoped(room,'pause'))).ok).toBe(false)
 })
 it('deduplicates purchases, rejects cross-seat mutations and stale room epochs, and synchronizes display data',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),room=await create(a)
  await b.command({kind:'join',roomId:room.id,password:''});const r=s.rooms.get(room.id)!,other=r.members.find(m=>m.userId===b.identity.userId)!
  const command:ServerCommand={kind:'game',roomId:room.id,epoch:room.epoch,action:{kind:'buy',id:'gun-damage'}}
  expect((await b.command(command,'same-purchase')).ok).toBe(true);expect((await b.command(command,'same-purchase')).ok).toBe(true)
  expect(r.coop!.world().participants![other.actorId]!.purchases[0]!.level).toBe(1);expect(r.coop!.world().participants![1]!.purchases).toEqual([])
  expect((await b.command({...command,epoch:room.epoch-1})).ok).toBe(false)
  expect((await b.command(scoped(room,'restart'))).ok).toBe(false)
  s.broadcast();const decoder=createSyncDecoder(),state=decoder.apply(await b.wait(p=>p.type==='sync'))!
  expect(state.snapshot.actors[0]!.id).toBe(other.actorId);expect(state.purchases[0]!.level).toBe(1)
  const wire=JSON.stringify(state);expect(wire).not.toContain(a.identity.token);expect(wire).not.toContain('basePlayerAttrs');expect(wire).not.toContain('pendingSpawns')
 })
 it('binds identity to the credential, reconnects the original seat, and replaces an older connection safely',async()=>{
  const {s,url,dir}=await server(),a=await client(url),room=await create(a),r=s.rooms.get(room.id)!
  await a.command({kind:'game',roomId:room.id,epoch:room.epoch,action:{kind:'buy',id:'gun-damage'}})
  const replaced=new Promise<number>(resolve=>a.ws.once('close',code=>resolve(code))),again=await client(url,a.identity)
  expect(await replaced).toBe(4001);const restored=(await again.wait(p=>p.type==='room'&&Boolean(p.room))).room as RoomInfo
  expect(restored.members).toHaveLength(1);expect(r.coop!.world().participants![1]!.purchases[0]!.level).toBe(1);expect(r.members[0]!.connected).toBe(true)
  const fake=new WebSocket(url.replace('http','ws')+'/socket',{origin:'https://what20360.github.io'});fake.on('error',()=>{});cleanup.push(async()=>{fake.terminate()});await new Promise<void>(resolve=>fake.once('open',()=>resolve()));const denied=new Promise<string>(resolve=>fake.once('message',data=>resolve(data.toString())));fake.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'hello',name:'冒名',userId:a.identity.userId,token:'not-the-token'}));expect(await denied).toContain('身份凭证无效')
  await again.close();await s.close();const db=await readFile(join(dir,'server.json'),'utf8');expect(db).not.toContain(a.identity.token)
 })
 it('supports moderator boundaries, ownership transfer, banning and removing the original engine host',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),c=await client(url),room=await create(a)
  await b.command({kind:'join',roomId:room.id,password:''});await c.command({kind:'join',roomId:room.id,password:''})
  const manage=(target:string,action:'promote'|'transfer'|'kick'|'ban')=>({kind:'manage' as const,roomId:room.id,epoch:room.epoch,target,action})
  expect((await a.command(manage(b.identity.userId,'promote'))).ok).toBe(true)
  expect((await b.command(manage(a.identity.userId,'kick'))).ok).toBe(false)
  expect((await b.command(manage(c.identity.userId,'promote'))).ok).toBe(false)
  expect((await a.command(manage(b.identity.userId,'transfer'))).ok).toBe(true)
  expect((await a.command(scoped(room,'pause'))).ok).toBe(false)
  expect((await b.command(manage(a.identity.userId,'kick'))).ok).toBe(true)
  expect(s.rooms.get(room.id)!.coop!.world().actors.has(1)).toBe(false)
  expect((await b.command(manage(c.identity.userId,'ban'))).ok).toBe(true)
  expect((await c.command({kind:'join',roomId:room.id,password:''})).ok).toBe(false)
  expect((await b.command(scoped(room,'export'))).ok).toBe(true)
 })
 it('preserves all five stable IDs, private builds and server identity through a process restart',async()=>{
  const {s,url,dir}=await server(),clients=await Promise.all(Array.from({length:5},(_,i)=>client(url,undefined,'队员'+i))),room=await create(clients[0]!)
  for(const c of clients.slice(1))await c.command({kind:'join',roomId:room.id,password:''})
  await clients[4]!.command({kind:'game',roomId:room.id,epoch:room.epoch,action:{kind:'buy',id:'gun-damage'}})
  const actorId=s.rooms.get(room.id)!.members.find(m=>m.userId===clients[4]!.identity.userId)!.actorId
  for(const c of clients)await c.close();await s.close()
  const next=await startPrismServer({dataDir:dir,port:0,host:'127.0.0.1',discovery:false,autoTick:false,createKey:'private-create-key'});cleanup.push(()=>next.close())
  const returned=await client(`http://127.0.0.1:${next.port}`,clients[4]!.identity),restored=(await returned.wait(p=>p.type==='room'&&Boolean(p.room))).room as RoomInfo
  expect(returned.identity.userId).toBe(clients[4]!.identity.userId);expect(restored.members.filter(m=>m.connected)).toHaveLength(1);expect(restored.members).toHaveLength(5)
  expect(next.rooms.get(room.id)!.coop!.world().participants![actorId]!.purchases[0]!.level).toBe(1);expect(next.rooms.get(room.id)!.coop!.world().paused).toBe(true);expect(restored.epoch).not.toBe(room.epoch)
  next.tick(Date.now()+61000);expect(next.rooms.get(room.id)!.ownerId).toBe(returned.identity.userId)
 })
 it('imports old party slots without granting old IDs authority and protects unclaimed builds with a password',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),room=await create(a,options({password:'private'})),old=createCoopMatch();const id=old.join('旧队友');old.action(id,{kind:'buy',id:'gun-damage'})
  old.rename('重聚的远征');expect((await a.command({kind:'import',roomId:room.id,epoch:room.epoch,save:old.save()})).ok).toBe(true)
  const restored=s.rooms.get(room.id)!;expect(restored.options.name).toBe('重聚的远征');expect(restored.coop!.save().name).toBe('重聚的远征');expect(restored.members.some(m=>m.userId==='unclaimed:'+id)).toBe(true)
  await a.command({kind:'leave',roomId:room.id,epoch:restored.epoch})
  expect((await b.command({kind:'join',roomId:room.id,password:'private',seat:id})).ok).toBe(true)
  expect(restored.ownerId).toBe(b.identity.userId);expect(restored.members.find(m=>m.actorId===id)!.userId).toBe(b.identity.userId);expect(restored.coop!.world().participants![id]!.purchases[0]!.level).toBe(1)
 })
 it('runs all three duel modes on the server and does not send the opponent’s purchase plan',async()=>{
  for(const duelMode of ['fixed','budget','resource'] as const){const {s,url}=await server(),a=await client(url),b=await client(url),room=await create(a,options({mode:'duel',duelMode}))
   await b.command({kind:'join',roomId:room.id,password:''});await a.command(scoped(room,'ready'));await b.command(scoped(room,'ready'))
   for(let i=0;i<181;i++)s.tick();s.broadcast();const decoded=createSyncDecoder().apply(await b.wait(p=>p.type==='sync'))!
   expect(decoded.mode).toBe('duel');expect(decoded.duel!.phase).toBe('fighting');expect(decoded.snapshot.actors[0]!.id).toBe(2);expect(decoded.duel).not.toHaveProperty('plans')
   expect((await b.command({kind:'game',roomId:room.id,epoch:s.rooms.get(room.id)!.epoch,action:{kind:'buy',id:'gun-damage'}})).ok).toBe(duelMode!=='fixed')
  }
 },12000)
 it('rejects untrusted origins and exposes a small compatible server info endpoint',async()=>{
  const {url}=await server(),info=await (await fetch(url+'/api/info')).json();expect(info.protocol).toBe(SERVER_PROTOCOL);expect(info).not.toHaveProperty('createKey')
  const ws=new WebSocket(url.replace('http','ws')+'/socket',{origin:'https://untrusted.example'});ws.on('error',()=>{});cleanup.push(async()=>{ws.terminate()});expect(await new Promise<string>(resolve=>ws.once('unexpected-response',(_req,res)=>{res.resume();resolve(String(res.statusCode))}))).toBe('403')
 })
})
describe('connection and identity primitives',()=>{
 it('answers real UDP discovery queries with the matching nonce and ignores unrelated traffic',async()=>{
  const discovery=createLanDiscovery(()=>({protocol:SERVER_PROTOCOL,serverId:'test-server',name:'局域网',createPolicy:'key',rooms:2,version:'1.23'}),()=>8787)
  cleanup.push(async()=>discovery.close());expect(await discovery.ready).toBe(true)
  const socket=dgram.createSocket('udp4'),replies:Record<string,unknown>[]=[]
  cleanup.push(()=>new Promise<void>(resolve=>socket.close(()=>resolve())))
  socket.on('message',data=>replies.push(JSON.parse(data.toString()) as Record<string,unknown>))
  await new Promise<void>(resolve=>socket.bind(0,'127.0.0.1',()=>resolve()))
  const reply=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('UDP discovery timed out')),1500);socket.once('message',()=>{clearTimeout(timer);resolve()})})
  for(const body of [{protocol:'unrelated',kind:'query',nonce:'wrong'},{protocol:'prism-discover-1',kind:'reply',nonce:'wrong'},{protocol:'prism-discover-1',kind:'query',nonce:'test-nonce'}])socket.send(Buffer.from(JSON.stringify(body)),DISCOVERY_PORT,'127.0.0.1')
  await reply;expect(replies).toHaveLength(1);expect(replies[0]).toMatchObject({protocol:'prism-discover-1',kind:'reply',nonce:'test-nonce',port:8787,info:{serverId:'test-server',rooms:2}})
 })
 it('normalizes public/LAN URLs without accepting URL credentials or arbitrary endpoint paths',()=>{
  expect(socketAddress('192.168.1.20:8787').href).toBe('ws://192.168.1.20:8787/socket');expect(socketAddress('prism.local:8787').protocol).toBe('ws:');expect(httpAddress('wss://game.example.com/socket').origin).toBe('https://game.example.com')
  for(const url of ['https://user:pass@example.com','ftp://example.com','https://example.com/secret','https://example.com/?token=secret'])expect(()=>socketAddress(url)).toThrow()
 })
 it('rejects prototype payloads, extra authority packets, invalid versions and non-finite inputs',()=>{
  expect(()=>decodeClient('{"protocol":"prism-server-1","__proto__":{}}')).toThrow()
  for(const value of [{protocol:'old',type:'hello',name:'a'},{protocol:SERVER_PROTOCOL,type:'state',hp:100},{protocol:SERVER_PROTOCOL,type:'input',roomId:'ABC123',epoch:1,sequence:1,intent:{move:{x:Infinity,y:0}}}])expect(()=>decodeClient(JSON.stringify(value))).toThrow()
 })
 it('stores bearer token hashes and salted room-password hashes, preserving identities on reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'prism-id-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const store=await openStore(dir),one=store.identify('玩家');await store.save();const reopened=await openStore(dir)
  expect(reopened.identify('改名',one.user.id,one.token).user.id).toBe(one.user.id);expect(()=>reopened.identify('冒名',one.user.id,'wrong')).toThrow()
  const hash=passwordHash('a-password');expect(hash).not.toContain('a-password');expect(passwordMatches('a-password',hash)).toBe(true);expect(passwordMatches('wrong',hash)).toBe(false)
 })
})
