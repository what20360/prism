// @vitest-environment happy-dom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {renderSettingsSection} from '../../src/ui/sections/settings'
import {PLAYER_BASE_ATTRS} from '../../src/content/player'
import {createTouchControls} from '../../src/input/touch'
import {createSettingsStore,CONFIG_STORAGE_KEY,DEFAULT_SETTINGS,type ControlSettings} from '../../src/storage/config'
const cleaners:(()=>void)[]=[]
afterEach(()=>{cleaners.splice(0).forEach(f=>f());document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks()})
function controls(settings:Partial<ControlSettings>={}){
 const root=document.createElement('div');document.body.append(root);const t=createTouchControls(root,()=>{});cleaners.push(t.dispose);t.configure!({...DEFAULT_SETTINGS,...settings})
 const move=root.querySelector<HTMLElement>('.touch-stick--move')!,fire=root.querySelector<HTMLElement>('.touch-stick--fire')!
 for(const pad of [move,fire]){Object.defineProperty(pad,'clientWidth',{configurable:true,value:120});pad.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:120,bottom:120,width:120,height:120,toJSON(){return {}}})}
 return {root,t,move,fire}
}
function pointer(node:Element,type:string,id:number,x=60,y=60){node.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true}))}
describe('mobile multi-touch and preferences',()=>{
 it('keeps movement, aiming and mine independent across three fingers and retains aim on release',()=>{
  const {root,t,move,fire}=controls();const mine=root.querySelector<HTMLElement>('.touch-mine')!
  pointer(move,'pointerdown',1,98,60);pointer(fire,'pointerdown',2,60,22);pointer(mine,'pointerdown',3)
  expect(t.read()).toMatchObject({fire:true,placeMine:true});expect(t.read().move.x).toBeGreaterThan(.9)
  pointer(move,'pointercancel',2);pointer(fire,'pointerup',1);expect(t.read().fire).toBe(true);expect(t.read().move.x).toBeGreaterThan(.9)
  pointer(fire,'pointerup',2);expect(t.read()).toMatchObject({fire:false,aim:{x:0}});expect(t.read().aim!.y).toBeLessThan(-.9)
  pointer(move,'pointerup',1);pointer(mine,'pointerup',3);expect(t.read().move).toEqual({x:0,y:0});expect(t.read().placeMine).toBe(false)
 })
 it('keeps a short fire tap until sampled once, but clears it on blur',()=>{
  const {t,fire}=controls();pointer(fire,'pointerdown',2,60,22);pointer(fire,'pointerup',2,60,22)
  expect(t.read().fire).toBe(true);expect(t.read().fire).toBe(false)
  pointer(fire,'pointerdown',2,60,22);pointer(fire,'pointerup',2,60,22);window.dispatchEvent(new Event('blur'));expect(t.read().fire).toBe(false)
 })
 it('remaps radial deadzone, buffers a quick tap once and clears everything on pause, resize and blur',()=>{
  const {root,t,move,fire}=controls({touchDeadzone:.2});pointer(move,'pointerdown',1,62,60);expect(t.read().move).toEqual({x:0,y:0})
  const mine=root.querySelector<HTMLElement>('.touch-mine')!;pointer(mine,'pointerdown',3);pointer(mine,'pointerup',3);expect(t.read().placeMine).toBe(true);expect(t.read().placeMine).toBe(false)
  for(const end of ['blur','resize']){pointer(move,'pointerdown',1,98,60);pointer(fire,'pointerdown',2,60,22);window.dispatchEvent(new Event(end));expect(t.read()).toMatchObject({move:{x:0,y:0},fire:false,aim:undefined})}
  pointer(fire,'pointerdown',2,60,22);t.setPaused(true);expect(t.read().fire).toBe(false);t.setPaused(false);expect(t.read().aim).toBeUndefined()
 })
 it('positions a floating stick at the finger, exposes left-hand sizing and leaves other preferences intact',()=>{
  const {root,t,move}=controls({touchStick:'floating',touchHand:'left',touchSize:130,touchOpacity:.4,touchInset:32})
  const layer=root.querySelector<HTMLElement>('.touch-controls')!;expect(layer.dataset).toMatchObject({hand:'left',stick:'floating'});expect(layer.style.getPropertyValue('--touch-scale')).toBe('1.3');expect(layer.style.getPropertyValue('--touch-inset')).toBe('32px')
  pointer(root.querySelector('.touch-move-zone')!,'pointerdown',1,240,300);expect(move.style.left).toBe('180px');expect(move.style.top).toBe('240px');pointer(move,'pointerup',1);expect(move.style.left).toBe('');t.reset()
 })
 it('migrates v4 settings and roundtrips mobile, audio, render and prediction preferences',()=>{
  localStorage.setItem(CONFIG_STORAGE_KEY,JSON.stringify({version:4,settings:{aimMode:'auto',fireMode:'manual',music:false,autoSaveMode:'off'}}));const store=createSettingsStore(localStorage)
  expect(store.load()).toMatchObject({aimMode:'auto',music:false,touchStick:'fixed',networkPrediction:true,autoSaveMode:'off'})
  const prefs={...store.load(),touchStick:'floating' as const,touchHand:'left' as const,touchSize:140,touchOpacity:.3,touchDeadzone:.3,touchInset:60,musicVolume:0,sfxVolume:.2,quality:'low' as const,networkPrediction:false};expect(store.save(prefs)).toBe(true);expect(store.load()).toEqual(prefs)
  localStorage.setItem(CONFIG_STORAGE_KEY,JSON.stringify({version:5,settings:{touchSize:10000,touchOpacity:-1,touchDeadzone:'no',touchInset:-8,quality:'wrong',musicVolume:8}}));expect(store.load()).toMatchObject({touchSize:140,touchOpacity:.3,touchDeadzone:.12,touchInset:8,quality:'balanced',musicVolume:1})
 })
 it('commits range preferences only after dragging ends and resets only the touch layout',()=>{
  const changed=vi.fn(),root=renderSettingsSection({...DEFAULT_SETTINGS,musicVolume:.8,touchHand:'left'}, {onSetting:changed},PLAYER_BASE_ATTRS);document.body.append(root)
  const volume=root.querySelector<HTMLInputElement>('[aria-label="音乐音量"]')!;volume.value='25';volume.dispatchEvent(new Event('input'));expect(changed).not.toHaveBeenCalled();expect(root.contains(volume)).toBe(true)
  volume.dispatchEvent(new Event('change'));expect(changed).toHaveBeenCalledWith('musicVolume',.25)
  changed.mockClear();Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='恢复默认触屏布局')!.click()
  expect(changed).toHaveBeenCalledTimes(6);expect(changed).toHaveBeenCalledWith('touchHand','right');expect(changed.mock.calls.every(c=>String(c[0]).startsWith('touch'))).toBe(true)
 })

})
