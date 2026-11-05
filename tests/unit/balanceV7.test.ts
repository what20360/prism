import { describe, expect, it } from 'vitest'
import { ALL_CARDS, CARD_REGISTRY } from '../../src/content/cards'
import { LEGACY_V6_REGISTRY } from '../../src/content/legacyCardsV6'
import { LEGACY_PLAYER_BASE_ATTRS } from '../../src/content/legacyPlayer'
import { PLAYER_BASE_ATTRS } from '../../src/content/player'
import { DEFAULT_ECONOMY } from '../../src/content/economy'
import { CARD_GROUPS, BASIC_CARD_TAGS } from '../../src/content/cardLayout'
import { dungeonEnemyPalette, buildDungeon } from '../../src/content/dungeon'
import { ENEMIES } from '../../src/content/enemies'
import { shieldCap } from '../../src/core/attrs'
import { resolveAttrs } from '../../src/core/cards'
import { buyCard, sellCard } from '../../src/core/progress'
import { createWorld, getPlayer } from '../../src/core/world'
import { serializeWorld } from '../../src/core/serialization'
import { updateTimers } from '../../src/core/systems/timers'
import { readCheckpoint, CURRENT_BALANCE_VERSION } from '../../src/app/checkpoints'
import { createCoopMatch, readCoopSave } from '../../src/app/modes/coop'

function legacyWorld(){return createWorld({seed:7,registry:LEGACY_V6_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:LEGACY_PLAYER_BASE_ATTRS,room:buildDungeon()[0]!})}
describe('coefficient shields and sniper specialization',()=>{
 it('derives the cap only from HP and coefficient, including zero scalar shields',()=>{
  expect(shieldCap({...PLAYER_BASE_ATTRS,shield:999})).toBe(0)
  expect(shieldCap({...PLAYER_BASE_ATTRS,shield:0,shieldCapMult:0.1})).toBe(5)
  for(const level of [1,2,10,30]){
   const attrs=resolveAttrs(PLAYER_BASE_ATTRS,[{id:'shield',level}],CARD_REGISTRY)
   expect(shieldCap(attrs)).toBeCloseTo(5*level);expect(attrs.shield).toBe(0);expect(attrs.shieldRegen).toBe(1)
  }
  expect(resolveAttrs(PLAYER_BASE_ATTRS,[{id:'shield',level:3},{id:'shield-regen',level:2}],CARD_REGISTRY).shieldRegen).toBe(7)
 })
 it('grants no instant shield, naturally restores one per second and clamps on sale',()=>{
  const w=createWorld({seed:7,registry:CARD_REGISTRY,economy:DEFAULT_ECONOMY,playerAttrs:PLAYER_BASE_ATTRS,room:buildDungeon()[0]!}),p=getPlayer(w);w.shards=1e6
  buyCard(w,'shield');buyCard(w,'shield');expect(p.shield).toBe(0);p.outOfCombatTicks=200
  for(let i=0;i<60;i++)updateTimers(w);expect(p.shield).toBeCloseTo(1)
  p.shield=9;sellCard(w,'shield');expect(p.shield).toBe(5);sellCard(w,'shield');expect(p.shield).toBe(0);expect(p.attrs.shieldRegen).toBe(0)
 })
 it.each([1,2,5])('divides fire rate by three per specialization level %i',level=>{
  const attrs=resolveAttrs(PLAYER_BASE_ATTRS,[{id:'precision-stance',level:1},{id:'sniper-specialty',level}],CARD_REGISTRY)
  expect(attrs.fireRate).toBeCloseTo(PLAYER_BASE_ATTRS.fireRate/3**level,12);expect(attrs.damage).toBe(20*2**level)
 })
})
describe('balance v6 to v7 saves',()=>{
 it('validates genuine old shield/sniper formulas, rebases once and retains wallet, payments, names and combat state',()=>{
  const w=legacyWorld();w.shards=10000;for(const id of ['shield','shield','precision-stance','sniper-specialty'])expect(buyCard(w,id).ok).toBe(true)
  const p=getPlayer(w);p.shield=20;p.hp=31
  const raw={format:'prism-save',version:1,balanceVersion:6,name:'原来的远征',savedAt:'2026-11-05T00:00:00Z',mode:'dungeon',initialSeed:7,restarts:2,difficulty:1,roomIndex:0,world:serializeWorld(w,true)}
  const loaded=readCheckpoint(JSON.stringify(raw))
  expect(loaded.balanceVersion).toBe(CURRENT_BALANCE_VERSION);expect(loaded.world.shards).toBe(w.shards);expect(loaded.world.purchases).toEqual(w.purchases);expect(loaded.name).toBe(raw.name)
  expect(loaded.world.actors[0]!.shield).toBe(10);expect(loaded.world.actors[0]!.hp).toBe(31);expect(loaded.world.actors[0]!.attrs.fireRate).toBeCloseTo(0.7/3)
  expect(loaded.world.basePlayerAttrs).toEqual(PLAYER_BASE_ATTRS);expect(readCheckpoint(JSON.stringify(loaded))).toEqual(loaded)
  raw.world.actors[0]!.attrs.damage++;expect(()=>readCheckpoint(JSON.stringify(raw))).toThrow()
 })
 it('migrates multiple and offline cooperative seats independently without granting starting funds again',()=>{
  const m=createCoopMatch(),ids=[m.hostId(),m.join('离线队员'),m.join('在线队员')],w={...m.world(),registry:LEGACY_V6_REGISTRY,basePlayerAttrs:{...LEGACY_PLAYER_BASE_ATTRS}}
  for(const id of ids){w.actors.get(id)!.attrs={...LEGACY_PLAYER_BASE_ATTRS};w.participants![id]!.shards=700;for(const card of ['shield','precision-stance','sniper-specialty'])expect(buyCard(w,card,id).ok).toBe(true);w.actors.get(id)!.shield=12}
  m.disconnect(ids[1]!);const raw={...m.save(),balanceVersion:6,world:serializeWorld(w,true)},loaded=readCoopSave(JSON.stringify(raw))
  for(const id of ids){const p=loaded.world.participants![id]!,actor=loaded.world.actors.find(a=>a.id===id)!;expect(p).toEqual(w.participants![id]);expect(actor.attrs).toEqual(resolveAttrs(PLAYER_BASE_ATTRS,p.purchases,CARD_REGISTRY));expect(actor.shield).toBeLessThanOrEqual(5)}
  expect(loaded.world.coop!.members[1]!.connected).toBe(false);expect(readCoopSave(JSON.stringify(loaded))).toEqual(loaded)
 })
})
describe('basic card directory and richer dungeon population',()=>{
 it('maps every live card exactly once, balances damage and trajectory and keeps weapon families adjacent',()=>{
  const ids=CARD_GROUPS.flatMap(g=>g.cards.map(c=>c[0]));expect(ids).toHaveLength(55);expect(new Set(ids).size).toBe(55);expect(ALL_CARDS.map(c=>c.id)).toEqual(ids)
  expect(CARD_GROUPS.find(g=>g.id==='damage')!.cards).toHaveLength(9);expect(CARD_GROUPS.find(g=>g.id==='trajectory')!.cards).toHaveLength(8)
  for(const c of ALL_CARDS){expect(c.tags?.length).toBeGreaterThan(0);for(const tag of c.tags??[])expect(BASIC_CARD_TAGS).toContain(tag);expect(c.summary?.(1)).not.toContain('可回收')}
  for(const [weapon,spec]of [['precision-stance','sniper-specialty'],['weapon-electric','arc-coil'],['weapon-laser','laser-focus']])expect(ids.indexOf(spec!)).toBe(ids.indexOf(weapon!)+1)
 })
 it('introduces electric skirmishers and shielded melee by difficulty/depth while retaining the final boss',()=>{
  expect(dungeonEnemyPalette(1,0)).not.toContain('arc-rider');expect(dungeonEnemyPalette(2,0)).toContain('arc-rider');expect(dungeonEnemyPalette(3,0)).toContain('bulwark');expect(dungeonEnemyPalette(1,2)).toEqual(expect.arrayContaining(['arc-rider','bulwark','lancer','warden']))
  const dungeon=buildDungeon({seed:7,difficulty:7}),types=dungeon.flatMap(r=>[r.spawns,...r.waves??[]].flat().map(s=>s.name))
  expect(types.some(n=>n?.includes(ENEMIES['arc-rider']!.name))).toBe(true);expect(types.some(n=>n?.includes(ENEMIES.bulwark!.name))).toBe(true)
  expect([dungeon.at(-1)!.spawns,...dungeon.at(-1)!.waves??[]].flat().filter(s=>s.behavior==='weaver')).toHaveLength(1);expect(shieldCap(ENEMIES.bulwark!.attrs)).toBe(20)
 })
})
