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
import {createActor} from '../../src/core/world'
import {ENEMIES} from '../../src/content/enemies'
import {passwordHash,passwordMatches,openStore} from '../../src/server/store'
import {createLogger} from '../../src/server/logger'
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
const scoped=(room:RoomInfo,kind:'ready'|'start'|'cancel-start'|'pause'|'restart'|'leave'|'export'|'close')=>({kind,roomId:room.id,epoch:room.epoch})
describe('authoritative server rooms over real WebSockets',()=>{
 it('lets five players move and fire even before they are ready in the waiting arena without changing the saved match',async()=>{
  const {s,url}=await server(),clients=await Promise.all(Array.from({length:5},()=>client(url))),room=await create(clients[0]!)
  for(const c of clients.slice(1))await c.command({kind:'join',roomId:room.id,password:''})
  const r=s.rooms.get(room.id)!,saved=JSON.stringify(r.coop!.save().world)
  s.broadcast();const states=await Promise.all(clients.map(async c=>createSyncDecoder().apply(await c.wait(p=>p.type==='sync'))!))
  for(const state of states){expect(state.waiting).toBe(true);expect(state.paused).toBe(false);expect(state.snapshot.actors.filter(a=>a.local)).toHaveLength(1)}
  for(const c of clients){c.ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'input',roomId:room.id,epoch:room.epoch,sequence:1,intent:{move:{x:1,y:0},aim:{x:0,y:-1},fire:true},offers:true}));await c.command({kind:'list'})}
  const before=r.waitingArena!.world.actors.get(r.members[0]!.actorId)!.pos.x
  for(let i=0;i<20;i++)s.tick()
  expect(r.waitingArena!.world.actors.get(r.members[0]!.actorId)!.pos.x).toBeGreaterThan(before);expect(r.waitingArena!.world.projectiles.length).toBeGreaterThan(0)
  const shooter=r.waitingArena!.world.actors.get(r.members[0]!.actorId)!,target=Array.from(r.waitingArena!.world.actors.values()).find(a=>a.team==='enemy'&&a.pos.x===1000)!;shooter.pos={x:target.pos.x,y:target.pos.y+300};shooter.fireCooldownTicks=0;target.hp=1
  clients[0]!.ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'input',roomId:room.id,epoch:room.epoch,sequence:2,intent:{move:{x:0,y:0},aim:{x:0,y:-1},fire:true},offers:true}));await clients[0]!.command({kind:'list'});for(let i=0;i<45;i++)s.tick()
  expect(r.waitingArena!.world.stats.kills).toBeGreaterThan(0);expect(r.waitingArena!.world.pickups).toHaveLength(0)
  expect(JSON.stringify(r.coop!.save().world)).toBe(saved);expect(s.inspectPlayer(clients[0]!.identity.userId)).toMatchObject({accepted:2,move:{x:0,y:0},fire:true})
  s.broadcast();const ready=(await clients[0]!.wait(p=>p.type==='room'&&Boolean((p.room as RoomInfo)?.members.length===5))).room as RoomInfo;expect(ready.members.filter(m=>m.ready).map(m=>m.userId)).toEqual([ready.ownerId])
 })
 it('sends consumed input acknowledgments over the compressed WebSocket sync',async()=>{
  const {s,url}=await server(),c=await client(url),room=await create(c),decoder=createSyncDecoder()
  c.ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'input',roomId:room.id,epoch:room.epoch,sequence:7,intent:{move:{x:1,y:0},fire:false}}));await c.command({kind:'list'})
  s.broadcast();expect(decoder.apply(await c.wait(p=>p.type==='sync'))!.inputAck).toEqual({sequence:-1,ticks:0,expired:false})
  s.tick();s.tick();s.broadcast();const state=decoder.apply(await c.wait(p=>p.type==='sync'))!
  expect(state.inputAck).toEqual({sequence:7,ticks:2,expired:false});expect('inputAck' in state.snapshot).toBe(false)
 })
 it('sends charger warning and relay armor links over real WebSockets',async()=>{
  const {s,url}=await server(),c=await client(url),room=await create(c);s.tick();const w=s.rooms.get(room.id)!.waitingArena!.world
  const relay=createActor(w,{...ENEMIES.relay!,team:'enemy',pos:{x:2500,y:450}})
  const guard=createActor(w,{...ENEMIES.drifter!,team:'enemy',pos:{x:2550,y:450}})
  const charger=createActor(w,{...ENEMIES.charger!,team:'enemy',pos:{x:2300,y:600}});charger.charge={phase:'windup',ticks:40,angle:.6,last:{...charger.pos}}
  s.broadcast();const state=createSyncDecoder().apply(await c.wait(p=>p.type==='sync'))!
  expect(state.snapshot.actors.find(a=>a.id===guard.id)?.supportRelayId).toBe(relay.id)
  expect(state.snapshot.actors.find(a=>a.id===charger.id)).toMatchObject({behavior:'charger',windupTicks:40,windupAngle:.6})
 })
 it('refunds the actual last-level price only in the waiting arena, including during the five-second countdown',async()=>{
  const {s,url}=await server(),a=await client(url),room=await create(a),r=s.rooms.get(room.id)!,wallet=()=>r.coop!.world().participants![1]!.shards
  const action=(kind:'buy'|'sell')=>a.command({kind:'game',roomId:r.id,epoch:r.epoch,action:{kind,id:'gun-damage'}})
  const initial=wallet();await action('buy');await action('buy');const afterBuying=wallet(),paid=r.coop!.world().participants![1]!.purchases[0]!.paid![1]!
  await action('sell');expect(wallet()).toBe(afterBuying+paid)
  await a.command(scoped(room,'start'));expect(r.startTicks).toBe(300);expect(r.coop!.started()).toBe(false)
  await action('sell');expect(wallet()).toBe(initial)
  await action('buy');const remaining=wallet();for(let i=0;i<299;i++)s.tick();expect(r.coop!.started()).toBe(false);expect(r.startTicks).toBe(1)
  s.tick();expect(r.coop!.started()).toBe(true);expect(r.coop!.world().tick).toBe(0);expect(r.coop!.world().projectiles).toHaveLength(0);expect(wallet()).toBe(remaining)
  await a.command({kind:'pause',roomId:r.id,epoch:r.epoch});const cost=r.coop!.world().participants![1]!.purchases[0]!.paid![0]!
  await action('sell');expect(wallet()).toBe(remaining+Math.floor(cost*.6));expect(wallet()).toBeLessThan(initial)
 })
 it('requires readiness and cancels countdowns on demand, joining, cancelling readiness and disconnecting',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),room=await create(a),r=s.rooms.get(room.id)!
  await a.command(scoped(room,'start'));await a.command({kind:'cancel-start',roomId:r.id,epoch:r.epoch});expect(r.startTicks).toBe(0)
  await a.command(scoped(room,'start'));await b.command({kind:'join',roomId:r.id,password:''});expect(r.startTicks).toBe(0)
  expect((await a.command(scoped(room,'start'))).ok).toBe(false)
  expect((await b.command(scoped(room,'ready'))).ok).toBe(true);expect((await a.command(scoped(room,'start'))).ok).toBe(true);expect(r.startTicks).toBe(300)
  await b.command(scoped(room,'ready'));expect(r.startTicks).toBe(0);expect(r.members.find(m=>m.userId===b.identity.userId)!.ready).toBe(false)
  await b.command(scoped(room,'ready'));await a.command(scoped(room,'start'));await b.close();await a.command({kind:'list'});expect(r.startTicks).toBe(0)
  expect(decodeClient(JSON.stringify({protocol:SERVER_PROTOCOL,type:'command',requestId:'ready',command:{kind:'ready',roomId:r.id,epoch:r.epoch}}))).toMatchObject({command:{kind:'ready'}})
 })
 it('clears training inputs at match start, accepts new movement/fire and expires unattended input',async()=>{
  const {s,url}=await server(),a=await client(url),room=await create(a),r=s.rooms.get(room.id)!
  const input=async(epoch:number,sequence:number)=>{a.ws.send(JSON.stringify({protocol:SERVER_PROTOCOL,type:'input',roomId:r.id,epoch,sequence,intent:{move:{x:1,y:0},aim:{x:0,y:-1},fire:true},offers:true}));await a.command({kind:'list'})}
  await input(r.epoch,1);await a.command(scoped(room,'start'));for(let i=0;i<300;i++)s.tick()
  const actor=r.coop!.world().actors.get(1)!,before=actor.pos.x;s.tick();expect(actor.pos.x).toBe(before);expect(r.coop!.world().projectiles).toHaveLength(0)
  await input(room.epoch,100);s.tick();expect(actor.pos.x).toBe(before);expect(s.inspectPlayer(a.identity.userId).rejected).toBe(1)
  await input(r.epoch,1);s.tick();expect(actor.pos.x).toBeGreaterThan(before);expect(r.coop!.world().projectiles.length).toBeGreaterThan(0)
  s.tick(Date.now()+1000);expect(actor.intent.fire).toBe(false);expect(actor.intent.move).toEqual({x:0,y:0})
 })
 it('provides operator diagnostics and room commands without leaking login secrets into logs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'prism-logs-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const logger=await createLogger({directory:dir,level:'debug',terminal:()=>{}});cleanup.push(()=>logger.close())
  const {s,url}=await server({logger}),a=await client(url),b=await client(url),room=await create(a)
  await b.command({kind:'join',roomId:room.id,password:''});expect((await s.admin('help')).text).toContain('input <玩家ID>');expect(JSON.parse((await s.admin('status')).text).players).toBe(2)
  expect((await s.admin('rooms')).text).toContain(room.id);expect((await s.admin('players '+room.id)).text).toContain(b.identity.userId)
  await b.command(scoped(room,'ready'));await s.admin('start '+room.id);expect(s.rooms.get(room.id)!.startTicks).toBe(300);await s.admin('cancel '+room.id);expect(s.rooms.get(room.id)!.startTicks).toBe(0)
  await s.admin('transfer '+room.id+' '+b.identity.userId);expect(s.rooms.get(room.id)!.ownerId).toBe(b.identity.userId)
  await s.admin('ban '+room.id+' '+a.identity.userId);expect((await a.command({kind:'join',roomId:room.id,password:''})).ok).toBe(false)
  await s.admin('unban '+room.id+' '+a.identity.userId);expect((await a.command({kind:'join',roomId:room.id,password:''})).ok).toBe(true)
  await s.admin('log info');expect(logger.getLevel()).toBe('info');await s.admin('save');expect(JSON.parse((await s.admin('input '+b.identity.userId)).text)).toMatchObject({received:0,ageMs:null})
  await expect(s.admin('close nonexistent')).rejects.toThrow();await s.admin('restart '+room.id);expect(s.rooms.get(room.id)!.coop!.started()).toBe(false)
  await s.admin('close '+room.id);expect(s.rooms.has(room.id)).toBe(false);expect((await s.admin('stop')).quit).toBe(true)
  await logger.flush();const text=await readFile(join(dir,'server.log'),'utf8');expect(text).toContain('client.authenticated');expect(text).toContain('room.created');expect(text).not.toContain(a.identity.token);expect(text).not.toContain('private-create-key')
 })
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
   await b.command({kind:'join',roomId:room.id,password:''});await b.command(scoped(room,'ready'));await a.command(scoped(room,'start'))
   for(let i=0;i<301;i++)s.tick();s.broadcast();const decoded=createSyncDecoder().apply(await b.wait(p=>p.type==='sync'))!
   expect(decoded.mode).toBe('duel');expect(decoded.duel!.phase).toBe('fighting');expect(decoded.snapshot.actors[0]!.id).toBe(2);expect(decoded.duel).not.toHaveProperty('plans')
   expect((await b.command({kind:'game',roomId:room.id,epoch:s.rooms.get(room.id)!.epoch,action:{kind:'buy',id:'gun-damage'}})).ok).toBe(duelMode!=='fixed')
  }
 },12000)
 it('automatically persists each cooperative room boundary without writing during the same room',async()=>{
  const {s,url,dir}=await server(),a=await client(url),room=await create(a),r=s.rooms.get(room.id)!
  await a.command(scoped(room,'start'));for(let i=0;i<300;i++)s.tick()
  const db=async()=>JSON.parse(await readFile(join(dir,'server.json'),'utf8')) as {rooms:{save:{started:boolean;roomIndex:number;world:{tick:number}}}[]}
  const until=async(predicate:(d:Awaited<ReturnType<typeof db>>)=>boolean)=>{for(let i=0;i<100;i++){const d=await db();if(predicate(d))return d;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('save did not reach expected room')}
  const first=await until(d=>d.rooms[0]!.save.started),bytes=await readFile(join(dir,'server.json'),'utf8')
  for(let i=0;i<20;i++)s.tick();expect(await readFile(join(dir,'server.json'),'utf8')).toBe(bytes)
  r.coop!.world().exitReached=true;s.tick();const next=await until(d=>d.rooms[0]!.save.roomIndex===1)
  expect(next.rooms[0]!.save.world.tick).toBeGreaterThan(first.rooms[0]!.save.world.tick);expect(s.status()).toMatchObject({autoSaveMode:'room',autoSaveSeconds:60})
 })
 it('saves a restarted run even when it has the same room ID, floor and seed',async()=>{
  const {s,url,dir}=await server(),a=await client(url),room=await create(a),r=s.rooms.get(room.id)!
  await a.command(scoped(room,'start'));for(let i=0;i<300;i++)s.tick();for(let i=0;i<20;i++)s.tick()
  r.coop!.world().shards=0;await s.admin('save')
  await a.command({kind:'restart',roomId:r.id,epoch:r.epoch});await a.command({kind:'start',roomId:r.id,epoch:r.epoch});await s.admin('save')
  for(let i=0;i<300;i++)s.tick()
  let started=false
  for(let i=0;i<100;i++){started=Boolean(JSON.parse(await readFile(join(dir,'server.json'),'utf8')).rooms[0].save.started);if(started)break;await new Promise(resolve=>setTimeout(resolve,5))}
  expect(started).toBe(true)
 })
 it('tracks endless floors as room epochs and resets readiness when restarting',async()=>{
  const {s,url}=await server(),a=await client(url),b=await client(url),room=await create(a,options({mode:'endless',coop:{...DEFAULT_COOP,mode:'endless',pauseOnDisconnect:false}})),r=s.rooms.get(room.id)!
  await b.command({kind:'join',roomId:room.id,password:''});await b.command(scoped(room,'ready'));await a.command(scoped(room,'start'));for(let i=0;i<300;i++)s.tick()
  const before=r.epoch;expect(r.roomIndex).toBe(1);r.coop!.world().exitReached=true;s.tick();expect(r.roomIndex).toBe(2);expect(r.epoch).toBe(before+1)
  expect(r.coop!.save().endless!.floor).toBe(2);await a.command({kind:'restart',roomId:r.id,epoch:r.epoch})
  expect(r.members.find(m=>m.userId===b.identity.userId)!.ready).toBe(false);expect((await a.command({kind:'start',roomId:r.id,epoch:r.epoch})).ok).toBe(false)
 })
 it('honors disabled progress saves while retaining explicit administrative persistence',async()=>{
  const {s,url,dir}=await server({autoSaveMode:'off'}),a=await client(url),room=await create(a)
  await a.command(scoped(room,'start'));await s.admin('save');const before=await readFile(join(dir,'server.json'),'utf8')
  for(let i=0;i<300;i++)s.tick();s.rooms.get(room.id)!.coop!.world().exitReached=true;s.tick()
  expect(await readFile(join(dir,'server.json'),'utf8')).toBe(before)
  await s.admin('save');expect(JSON.parse(await readFile(join(dir,'server.json'),'utf8')).rooms[0].save.roomIndex).toBe(1)
 })
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
  expect(()=>decodeClient('{"protocol":"prism-server-6","__proto__":{}}')).toThrow()
  for(const value of [{protocol:'old',type:'hello',name:'a'},{protocol:SERVER_PROTOCOL,type:'state',hp:100},{protocol:SERVER_PROTOCOL,type:'input',roomId:'ABC123',epoch:1,sequence:1,intent:{move:{x:Infinity,y:0}}}])expect(()=>decodeClient(JSON.stringify(value))).toThrow()
 })
 it('stores bearer token hashes and salted room-password hashes, preserving identities on reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'prism-id-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const store=await openStore(dir),one=store.identify('玩家');await store.save();const reopened=await openStore(dir)
  expect(reopened.identify('改名',one.user.id,one.token).user.id).toBe(one.user.id);expect(()=>reopened.identify('冒名',one.user.id,'wrong')).toThrow()
  const hash=passwordHash('a-password');expect(hash).not.toContain('a-password');expect(passwordMatches('a-password',hash)).toBe(true);expect(passwordMatches('wrong',hash)).toBe(false)
 })
})
