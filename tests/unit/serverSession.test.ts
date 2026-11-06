// @vitest-environment happy-dom
import {afterEach,describe,it,expect,vi} from 'vitest'
import {createServerSession} from '../../src/app/serverSession'
import {createKeyboardInput} from '../../src/input/keyboard'
import {createTouchControls} from '../../src/input/touch'
import {createPointerInput} from '../../src/input/pointer'
import {DEFAULT_SETTINGS} from '../../src/storage/config'
import {createPlanManager} from '../../src/app/planManager'
import {createRoom,joinRoom,roomInfo,playState} from '../../src/server/rooms'
import {DEFAULT_COOP} from '../../src/app/modes/coop'
import {createSyncEncoder} from '../../src/net/sync'
import type {ClientPacket,ServerInfo} from '../../src/net/serverProtocol'
const id='P-00000000-0000-4000-8000-000000000001'
class Socket {
 static OPEN=1;static latest:Socket;readyState=1;bufferedAmount=0;sent:ClientPacket[]=[]
 onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:((e:{code:number})=>void)|null=null
 constructor(){Socket.latest=this;queueMicrotask(()=>this.onopen?.())}
 send(text:string){this.sent.push(JSON.parse(text) as ClientPacket)}
 emit(value:unknown){this.onmessage?.({data:JSON.stringify(value)})}
 close(){this.readyState=3}
}
const cleanup:(()=>void)[]=[]
afterEach(()=>{cleanup.splice(0).reverse().forEach(f=>f());vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();localStorage.clear()})
async function setup(realTouch=false,guest=false){
 const info:ServerInfo={protocol:'prism-server-4',serverId:'test-server',version:'1.25',rooms:0,name:'测试服务器',createPolicy:'key'}
 const frames=new Map<number,FrameRequestCallback>();let frameId=0
 vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{frames.set(++frameId,f);return frameId});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id))
 vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('fetch',async()=>({ok:true,text:async()=>JSON.stringify(info)}));vi.spyOn(document,'hidden','get').mockReturnValue(false)
 const canvas=document.createElement('canvas');document.body.append(canvas)
 const input=createKeyboardInput(window),pointer=createPointerInput(canvas),touch=realTouch?createTouchControls(document.body,()=>{}):{read:()=>({move:{x:0,y:0}}),reset(){},setPaused(){},setVisible(){},update(){},dispose(){}}
 const renderer={draw:vi.fn(),viewToWorld:(x:number,y:number)=>({x,y}),dispose(){}}
 const plans=createPlanManager({game:()=>undefined,refresh:()=>{},saved:()=>{}})
 const session=createServerSession({root:document.body,input,pointer,touch,renderer,settings:()=>DEFAULT_SETTINGS,onSetting:()=>{},plans,leave:()=>{}})
 cleanup.push(()=>{session.dispose();input.dispose();pointer.dispose();touch.dispose()})
 const field=(name:string)=>document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!
 const click=(name:string)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name);expect(b,`button ${name}`).toBeTruthy();b!.click()}
 field('服务器地址').value='http://127.0.0.1:8787';click('连接服务器');await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve()
 const socket=Socket.latest;socket.emit({type:'welcome',userId:id,token:'a'.repeat(43),info})
 const room=createRoom({id:guest?'P-00000000-0000-4000-8000-000000000002':id,name:'队员',hash:'unused',created:0},{name:'测试房间',mode:'dungeon',duelMode:'budget',coop:DEFAULT_COOP,password:'',hidden:false},0),encoder=createSyncEncoder()
 if(guest)joinRoom(room,{id,name:'队员',hash:'unused',created:0},'')
 let lastEpoch=room.epoch
 const sync=()=>{if(room.epoch!==lastEpoch){encoder.reset();lastEpoch=room.epoch};socket.emit({type:'room',room:roomInfo(room)});socket.emit(encoder.encode(playState(room,id),performance.now()))}
 const frame=(now:number)=>{const callbacks=[...frames.values()];frames.clear();for(const f of callbacks)f(now)}
 sync();return {session,socket,room,sync,frame,click,input,canvas,renderer,touch}
}
describe('server browser session controls',()=>{
 it('enters a playable waiting arena and gives the host a quick start button',async()=>{
  const t=await setup();expect(document.querySelector('.server-lobby')!.hasAttribute('hidden')).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('.server-start-button')!.textContent).toBe('开始对局（5秒倒计时）');expect(t.session.active()).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));t.canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',clientX:900,clientY:350,bubbles:true}));t.frame(1000)
  expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({intent:{move:{x:1,y:0},fire:true}})
 })
 it('draws local movement before the next snapshot and sends taps sampled between packet windows',async()=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(1000),t=await setup(true)
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));t.frame(1000)
  const first=t.renderer.draw.mock.calls.at(-1)![0] as import('../../src/core/snapshot').Snapshot,x=first.actors.find(a=>a.local)!.x
  const mine=document.querySelector<HTMLElement>('.touch-mine')!;mine.dispatchEvent(new PointerEvent('pointerdown',{pointerId:3,bubbles:true}));mine.dispatchEvent(new PointerEvent('pointerup',{pointerId:3,bubbles:true}));t.frame(1010)
  clock.mockReturnValue(1050);t.frame(1050);const moved=t.renderer.draw.mock.calls.at(-1)![0] as import('../../src/core/snapshot').Snapshot
  expect(moved.actors.find(a=>a.local)!.x).toBeGreaterThan(x);expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({intent:{placeMine:true}})
  t.socket.emit({type:'pong',time:Date.now()-45});t.frame(1060);expect(document.querySelector('.network-badge')!.textContent).toContain('45 ms')
  t.session.toggleMenu();t.frame(1100);expect(document.querySelector<HTMLElement>('.network-badge')!.hidden).toBe(true)
 })
 it('lets guests ready/cancel from the arena and disables host start until guests are ready',async()=>{
  const t=await setup(false,true),quick=document.querySelector<HTMLButtonElement>('.server-start-button')!
  expect(quick.hidden).toBe(false);expect(quick.textContent).toBe('准备');quick.click()
  expect(t.socket.sent.at(-1)).toMatchObject({type:'command',command:{kind:'ready'}})
  t.room.members.find(m=>m.userId===id)!.ready=true;t.room.startTicks=300;t.sync()
  expect(quick.hidden).toBe(false);expect(quick.textContent).toBe('取消准备');quick.click()
  expect(t.socket.sent.at(-1)).toMatchObject({type:'command',command:{kind:'ready'}})
 })
 it('updates the host quick-start state when a guest becomes ready',async()=>{
  const t=await setup();joinRoom(t.room,{id:'P-00000000-0000-4000-8000-000000000002',name:'客人',hash:'unused',created:0},'');t.sync()
  const quick=document.querySelector<HTMLButtonElement>('.server-start-button')!;expect(quick.disabled).toBe(true);expect(quick.textContent).toContain('等待1人准备')
  t.room.members[1]!.ready=true;t.sync();expect(quick.disabled).toBe(false);quick.click()
  expect(t.socket.sent.at(-1)).toMatchObject({type:'command',command:{kind:'start'}})
 })
 it('shows the authoritative countdown and uses server-priced full refunds during preparation',async()=>{
  const t=await setup();t.room.coop!.action(1,{kind:'buy',id:'gun-damage'});t.room.startTicks=300;t.sync()
  expect(document.querySelector('.server-stage')!.textContent).toContain('5 秒后开始');const bought=t.room.coop!.world().participants![1]!.purchases[0]!
  expect(t.session.cards().find(c=>c.id==='gun-damage')!.refund).toBe(bought.paid![0]);t.session.toggleMenu();expect(document.querySelector('.cards__intro')!.textContent).toContain('100%')
  t.room.coop!.start();t.room.startTicks=0;t.room.epoch++;t.sync();expect(t.session.cards().find(c=>c.id==='gun-damage')!.refund).toBe(Math.floor(bought.paid![0]!*.6));expect(document.querySelector('.cards__intro')!.textContent).toContain('60%')
 })
 it('supports simultaneous touch movement and shooting in the waiting arena',async()=>{
  const t=await setup(true),move=document.querySelector<HTMLElement>('[aria-label="移动"]')!,fire=document.querySelector<HTMLElement>('[aria-label="瞄准 / 射击"]')!
  for(const pad of [move,fire]){pad.setPointerCapture=()=>{};pad.hasPointerCapture=()=>false;Object.defineProperty(pad,'clientWidth',{value:100});pad.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:100,bottom:100,width:100,height:100,toJSON(){}})}
  move.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:82,clientY:50,bubbles:true}));fire.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,clientX:50,clientY:18,bubbles:true}));t.frame(1000)
  expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({intent:{move:{x:1,y:0},fire:true}})
 })
 it('clears held input while the menu or hidden page suppresses gameplay',async()=>{
  const t=await setup();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));t.frame(1000);t.session.toggleMenu();t.frame(1100)
  expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({intent:{move:{x:0,y:0},fire:false}})
  t.session.toggleMenu();t.frame(1200);expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({intent:{move:{x:0,y:0}}})
  vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));expect(t.socket.sent.filter(p=>p.type==='input').at(-1)).toMatchObject({offers:false,intent:{fire:false}})
 })
 it('shows a defeat settlement and leaves navigation to the player',async()=>{
  const t=await setup();t.room.coop!.start();t.sync();t.room.coop!.world().gameOver=true;t.sync()
  const result=document.querySelector<HTMLElement>('[aria-label="联机对局结算"]')!;expect(result.hidden).toBe(false);expect(result.textContent).toContain('全队阵亡');expect(document.querySelector<HTMLElement>('.server-lobby')!.hidden).toBe(true)
  t.click('查看战场');expect(result.hidden).toBe(true);expect(document.querySelector<HTMLElement>('.server-lobby')!.hidden).toBe(true)
 })
 it('only returns to room management when selected and dismisses results on an explicit restart',async()=>{
  const t=await setup();t.room.coop!.start();t.sync();t.room.coop!.world().gameOver=true;t.sync();t.click('返回房间');expect(document.querySelector<HTMLElement>('.server-lobby')!.hidden).toBe(false)
  t.room.coop!.restart();t.room.epoch++;t.sync();expect(document.querySelector<HTMLElement>('[aria-label="联机对局结算"]')!.hidden).toBe(true);expect(t.session.active()).toBe(true)
 })
 it('sends movement and manual fire after the room starts',async()=>{
  const t=await setup();expect(t.room.coop!.start()).toBe(true);t.sync()
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));t.canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',clientX:900,clientY:600,bubbles:true}))
  t.frame(1000)
  const packet=t.socket.sent.filter(p=>p.type==='input').at(-1)!
  expect(packet).toMatchObject({type:'input',intent:{move:{x:1,y:0},fire:true}})
 })
})
