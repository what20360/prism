import dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'
import { SERVER_PROTOCOL, type ServerInfo } from '../net/serverProtocol'
export const DISCOVERY_PORT=47873,DISCOVERY_GROUP='239.255.77.73'
export interface DiscoveredServer {serverId:string;name:string;address:string;rooms:number}
const interfaces=()=>{try{return Object.values(networkInterfaces()).flatMap(list=>(list??[]).filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address))}catch{return []}}
export function localAddresses(port:number):string[] {return interfaces().map(address=>`http://${address}:${port}`)}
export function createLanDiscovery(info:()=>ServerInfo,port:()=>number) {
 const responder=dgram.createSocket({type:'udp4',reuseAddr:true}),queries=new Set<()=>void>()
 const ready=new Promise<boolean>(resolve=>{responder.once('listening',()=>resolve(true));responder.once('error',()=>resolve(false))})
 responder.on('error',()=>{/* Manual addressing remains available on networks without multicast. */})
 responder.on('message',(data,remote)=>{if(data.length>1024)return;try{const message=JSON.parse(data.toString()) as {protocol?:string;kind?:string;nonce?:string};if(message.protocol!=='prism-discover-1'||message.kind!=='query'||typeof message.nonce!=='string'||message.nonce.length>80)return
  responder.send(Buffer.from(JSON.stringify({protocol:'prism-discover-1',kind:'reply',nonce:message.nonce,info:info(),port:port()})),remote.port,remote.address)
 }catch{/* Ignore non-PRISM LAN traffic. */}})
 responder.bind(DISCOVERY_PORT,'0.0.0.0',()=>{for(const address of interfaces())try{responder.addMembership(DISCOVERY_GROUP,address)}catch{/* NIC may be down. */}})
 return {ready,search:()=>new Promise<DiscoveredServer[]>(resolve=>{
  const query=dgram.createSocket('udp4'),nonce=randomUUID(),peers=new Map<string,DiscoveredServer>();let done=false
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);queries.delete(finish);try{query.close()}catch{/* Not yet bound. */};resolve([...peers.values()])},timer=setTimeout(()=>finish(),900)
  queries.add(finish);query.on('error',finish)
  query.on('message',(data,remote)=>{if(data.length>2048)return;try{const m=JSON.parse(data.toString()) as {protocol:string;kind:string;nonce:string;info:ServerInfo;port:number};if(m.protocol!=='prism-discover-1'||m.kind!=='reply'||m.nonce!==nonce||m.info?.protocol!==SERVER_PROTOCOL||!Number.isInteger(m.port)||m.port<1||m.port>65535||typeof m.info.serverId!=='string')return;peers.set(m.info.serverId,{serverId:m.info.serverId,name:String(m.info.name).slice(0,60),address:`http://${remote.address}:${m.port}`,rooms:Number(m.info.rooms)||0})}catch{/* Ignore malformed replies. */}})
  query.bind(0,()=>{query.setMulticastTTL(1);query.setMulticastLoopback(true);const body=Buffer.from(JSON.stringify({protocol:'prism-discover-1',kind:'query',nonce}));query.send(body,DISCOVERY_PORT,DISCOVERY_GROUP)})
 }),close:()=>{for(const finish of queries)finish();try{responder.close()}catch{/* Startup may not have bound yet. */}}}
}
