import { describe, expect, it, vi } from 'vitest'
import { createAutoSaveSchedule } from '../../src/app/autoSave'
import { createSaveManager } from '../../src/app/saveManager'
import { CURRENT_BALANCE_VERSION, type RunCheckpoint } from '../../src/app/checkpoints'
import { createWorld } from '../../src/core/world'
import { serializeWorld } from '../../src/core/serialization'
import { CARD_REGISTRY } from '../../src/content/cards'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { buildDungeon } from '../../src/content/dungeon'
import { DEFAULT_SETTINGS, createSettingsStore, CONFIG_STORAGE_KEY } from '../../src/storage/config'

describe('room-based automatic saves', () => {
 it('saves once per successful progress key, supports intervals and never saves while off', () => {
  const policy=createAutoSaveSchedule()
  expect(policy.due(null,'room',60,0)).toBe(false)
  expect(policy.due('run:room1','room',60,0)).toBe(true)
  policy.saved('run:room1',0)
  expect(policy.due('run:room1','room',60,1e9)).toBe(false)
  expect(policy.due('run:room2','room',60,1)).toBe(true)
  expect(policy.due('run:room1','interval',60,59999)).toBe(false)
  expect(policy.due('run:room1','interval',60,60000)).toBe(true)
  expect(policy.due('run:room2','off',60,1e9)).toBe(false)
 })
 it('does not capture or serialize on repeated same-room polls, retries failed writes and preserves manual saves', () => {
  const world=createWorld({seed:42,room:buildDungeon()[0]!,playerAttrs:PLAYER_BASE_ATTRS,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY})
  const saved:RunCheckpoint={format:'prism-save',version:1,balanceVersion:CURRENT_BALANCE_VERSION,savedAt:'2026-11-05T00:00:00Z',mode:'dungeon',initialSeed:42,restarts:0,roomIndex:0,world:serializeWorld(world)}
  let key='first:0',fail=true,now=0,settings={...DEFAULT_SETTINGS}
  const data=new Map<string,string>(),capture=vi.fn(()=>saved),writes=vi.fn((k:string,v:string)=>{if(fail)throw new Error('quota');data.set(k,v)})
  const m=createSaveManager({capture,load:()=>{},refresh:()=>{},autoKey:()=>key,settings:()=>settings,now:()=>now,storage:{getItem:k=>data.get(k)??null,setItem:writes}})
  m.autoSave();expect(writes).toHaveBeenCalledTimes(1);fail=false;m.autoSave();expect(writes).toHaveBeenCalledTimes(2)
  capture.mockClear();for(let i=0;i<100;i++)m.autoSave();expect(capture).not.toHaveBeenCalled()
  key='first:1';m.autoSave();expect(capture).toHaveBeenCalledTimes(1)
  settings={...settings,autoSaveMode:'interval',autoSaveSeconds:5};now=4999;m.autoSave();expect(writes).toHaveBeenCalledTimes(3)
  now=5000;m.autoSave();expect(writes).toHaveBeenCalledTimes(4)
  settings={...settings,autoSaveMode:'off'};key='next-run:0';m.autoSave();expect(writes).toHaveBeenCalledTimes(4)
  m.handlers.onSave('slot-1');expect(writes).toHaveBeenCalledTimes(5);expect(data.has('prism.save.v1.slot-1')).toBe(true)
  settings={...settings,autoSaveMode:'room'};m.autoSave();expect(writes).toHaveBeenCalledTimes(6)
 })
 it('migrates old preferences to room saves and persists validated intervals', () => {
  let raw=JSON.stringify({version:3,settings:{aimMode:'auto',fireMode:'auto'}})
  const store=createSettingsStore({getItem:()=>raw,setItem:(key,v)=>{expect(key).toBe(CONFIG_STORAGE_KEY);raw=v}})
  expect(store.load()).toMatchObject({aimMode:'auto',fireMode:'auto',autoSaveMode:'room',autoSaveSeconds:60})
  store.save({...store.load(),autoSaveMode:'interval',autoSaveSeconds:35});expect(store.load()).toMatchObject({autoSaveMode:'interval',autoSaveSeconds:35})
  raw=JSON.stringify({version:4,settings:{autoSaveMode:'other',autoSaveSeconds:-1}});expect(store.load()).toMatchObject({autoSaveMode:'room',autoSaveSeconds:60})
 })
})
