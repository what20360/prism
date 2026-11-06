import {describe,expect,it} from 'vitest'
import {createLocalPrediction} from '../../src/net/prediction'
import {createInputBuffer} from '../../src/net/inputBuffer'
import {createRemoteInput} from '../../src/net/control'
import {createWorld} from '../../src/core/world'
import {toSnapshot} from '../../src/core/snapshot'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {CARD_REGISTRY} from '../../src/content/cards'
import {DEFAULT_ECONOMY} from '../../src/content/economy'
import type {Intent} from '../../src/core/controller'
const intent=(x=1,y=0):Intent=>({move:{x,y},aim:{x:0,y:1},fire:false})
function scene(){const w=createWorld({seed:1,economy:DEFAULT_ECONOMY,registry:CARD_REGISTRY,playerAttrs:{...PLAYER_BASE_ATTRS,speed:200},room:{id:'predict',kind:'combat',bounds:{x:0,y:0,width:2000,height:1200},walls:[],spawns:[],pickups:[],entry:{x:100,y:500}}});return toSnapshot(w)}
describe('local display prediction and authoritative acknowledgments',()=>{
 it('responds before a server reply without changing the snapshot or remote actors',()=>{
  const p=createLocalPrediction(),initial=scene(),s={...initial,actors:[...initial.actors,{...initial.actors[0]!,id:9,local:false,x:600}]}
  const before=JSON.stringify(s);p.accept(s,{sequence:-1,ticks:0,expired:false},0);p.record(0,intent(),0)
  const shown=p.read(s,100,intent());expect(shown.actors[0]!.x).toBe(120);expect(shown.actors[0]!.aimAngle).toBe(Math.PI/2);expect(shown.actors[1]).toEqual(s.actors[1]);expect(JSON.stringify(s)).toBe(before)
 })
 it('replays only time not consumed by the server, with identical wall collision',()=>{
  const p=createLocalPrediction(),s=scene();p.accept(s,{sequence:-1,ticks:0,expired:false},0);p.record(0,intent(),0)
  const server={...s,actors:s.actors.map(a=>({...a,x:110}))};p.accept(server,{sequence:0,ticks:3,expired:false},100)
  expect(p.read(server,100).actors[0]!.x).toBe(120)
  const wall={...scene(),walls:[{x:160,y:0,width:30,height:1200}]};const q=createLocalPrediction();q.accept(wall,{sequence:-1,ticks:0,expired:false},0);q.record(0,intent(),0)
  expect(q.read(wall,200).actors[0]!.x).toBeLessThanOrEqual(160-wall.actors[0]!.radius)
 })
 it('caps lead at 250ms using the latest direction, then freezes on missing updates',()=>{
  const p=createLocalPrediction(),s=scene();p.accept(s,{sequence:-1,ticks:0,expired:false},0);p.record(0,intent(),0);p.record(1,intent(0,1),200)
  const a=p.read(s,300).actors[0]!;expect(a.x).toBe(130);expect(a.y).toBe(520)
  expect(p.stale(351)).toBe(true);expect(p.read(s,351).actors[0]!.x).toBe(100)
  p.accept(s,{sequence:1,ticks:1,expired:true},400);expect(p.read(s,410).actors[0]!.y).toBe(500)
 })
 it('discards old movement on death, revival, teleport and explicit reset',()=>{
  const p=createLocalPrediction(),s=scene();p.accept(s,undefined,0);p.record(0,intent(),0)
  const dead={...s,actors:s.actors.map(a=>({...a,alive:false}))};p.accept(dead,undefined,100);expect(p.read(dead,120).actors[0]!.x).toBe(100)
  p.accept(s,undefined,150);expect(p.read(s,200).actors[0]!.x).toBe(100)
  p.record(1,intent(),200);const jump={...s,actors:s.actors.map(a=>({...a,x:800}))};p.accept(jump,undefined,230);expect(p.read(jump,240).actors[0]!.x).toBe(800)
  p.reset();expect(p.read(s,300)).toBe(s)
 })
 it('acknowledges consumption rather than receipt, and counts only the latest sequence ticks',()=>{
  const input=createRemoteInput();input.accept({sequence:8,round:1,intent:intent()},1,0);expect(input.ack(0)).toEqual({sequence:-1,ticks:0,expired:false})
  input.read(1);input.read(17);expect(input.ack(17)).toEqual({sequence:8,ticks:2,expired:false})
  input.accept({sequence:9,round:1,intent:intent(0,1)},1,20);expect(input.ack(20).sequence).toBe(8);input.read(33);expect(input.ack(33).ticks).toBe(1)
  input.read(400);expect(input.ack(400)).toEqual({sequence:9,ticks:1,expired:true});input.reset();expect(input.ack(401).sequence).toBe(-1)
 })
 it('retains short mine, skill and lock taps until sent, including clearing the lock',()=>{
  const b=createInputBuffer();b.push({...intent(),fire:true,skills:[0],placeMine:true,lockTarget:12});b.push({...intent(),skills:[1]});b.push(intent())
  expect(b.peek()).toMatchObject({fire:true,skills:[0,1],placeMine:true,lockTarget:12});expect(b.peek().skills).toEqual([0,1]);b.sent();expect(b.peek()).toMatchObject({fire:false,skills:[],placeMine:false})
  b.push({...intent(),lockTarget:null});b.push(intent());expect(b.peek().lockTarget).toBeNull();b.reset();expect(b.peek().fire).toBe(false);expect(b.peek().lockTarget).toBeUndefined()
 })
})
