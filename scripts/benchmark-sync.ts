import {deflateRawSync} from 'node:zlib'
import {performance} from 'node:perf_hooks'
import {createRoom,joinRoom,playState} from '../src/server/rooms'
import {DEFAULT_COOP} from '../src/app/modes/coop'
import {emitProjectile} from '../src/core/systems/weapons'
import {updateProjectiles} from '../src/core/systems/projectiles'
import {createSyncEncoder,createSyncDecoder} from '../src/net/sync'
const user={id:'benchmark',name:'基准',hash:'unused',created:0}
for(const count of [0,100,500]){
 const r=createRoom(user,{name:'基准',mode:'dungeon',duelMode:'budget',coop:{...DEFAULT_COOP,pauseOnDisconnect:false},hidden:false,password:''},0)
 for(let i=1;i<5;i++)joinRoom(r,{...user,id:'user'+i},'')
 for(const m of r.members)r.coop!.ready(m.actorId,true);r.coop!.start()
 const w=r.coop!.world(),p=w.actors.get(1)!;Object.assign(w.room,{bounds:{x:0,y:0,width:100000,height:100000},walls:[]});p.pos={x:50000,y:50000};p.attrs={...p.attrs,range:100000};for(let i=0;i<count;i++)emitProjectile(w,p,i*.01)
 const encoder=createSyncEncoder(),decoder=createSyncDecoder();let old=0,raw=0,zipped=0,encode=0,decode=0
 for(let i=0;i<50;i++){w.tick+=6;updateProjectiles(w,.1);old+=Buffer.byteLength(JSON.stringify(r.coop!.save(r.members[1]!.actorId)));let t=performance.now();const text=JSON.stringify(encoder.encode(playState(r,'user1'),i*100));encode+=performance.now()-t;raw+=Buffer.byteLength(text);zipped+=deflateRawSync(text,{level:3}).length;t=performance.now();decoder.apply(JSON.parse(text));decode+=performance.now()-t}
 console.log(JSON.stringify({players:5,projectiles:count,samples:50,legacyBytesPerFrame:Math.round(old/50),deltaBytesPerFrame:Math.round(raw/50),deflatedBytesPerFrame:Math.round(zipped/50),reductionPercent:Number((100*(1-zipped/old)).toFixed(1)),encodeMsPerClientFrame:Number((encode/50).toFixed(3)),decodeMsPerClientFrame:Number((decode/50).toFixed(3)),roomEgressMbps:Number((zipped/50*10*5*8/1e6).toFixed(3))}))
}
