import { resolveSpawnPosition, distance } from './collision'
import { hasLineOfSight } from './navigation'
import type { Actor, Pickup, World } from './world'

export const COOP_REVIVE_TICKS = 300
export function onlineMembers(world: World) { return world.coop?.members.filter((m) => m.connected) ?? [] }
export function resourceWeights(world: World, owner?: number, contributions?: Record<number, number>): [number, number][] {
  const members = onlineMembers(world), mode = world.coop?.resourceMode
  if (!members.length) return []
  if (mode === 'equal') return members.map((m) => [m.id, 1 / members.length])
  if (mode === 'damage') {
    const total = members.reduce((sum,m) => sum + (contributions?.[m.id] ?? 0), 0), base = total > 0 ? world.coop!.baseShare : 1
    return members.map((m) => [m.id, base / members.length + (total > 0 ? (1 - base) * (contributions?.[m.id] ?? 0) / total : 0)])
  }
  return [[members.some((m) => m.id === owner) ? owner! : members[0]!.id, 1]]
}
export function grantCoopShards(world: World, amount: number, owner: number, contributions?: Record<number, number>, gainApplied = false): void {
  for (const [id, weight] of resourceWeights(world, owner, contributions)) {
    const actor = world.actors.get(id), progress = world.participants?.[id]
    if (actor && progress) progress.shards += amount * weight * (gainApplied ? 1 : actor.attrs.shardGain)
  }
}
export function canCollectCoop(world: World, pickup: Pickup, actor: Actor): boolean {
  if (!world.coop) return true
  if (!world.coop.members.some((m) => m.id === actor.id && m.connected)) return false
  if (world.coop.resourceMode !== 'killer' || pickup.ownerId === undefined) return true
  return pickup.ownerId === actor.id || !world.coop.members.some((m) => m.id === pickup.ownerId && m.connected)
}
export function collectCoop(world: World, pickup: Pickup, collector: Actor, amount: number): void {
  if (pickup.kind === 'shard') { grantCoopShards(world, amount, collector.id, pickup.contributions, pickup.gainApplied); return }
  const shared = world.coop!.resourceMode === 'equal' || world.coop!.resourceMode === 'damage'
  if (!shared) { collector.hp = Math.min(collector.attrs.maxHp, collector.hp + amount); return }
  const weighted = resourceWeights(world, collector.id, pickup.contributions).filter(([id]) => world.actors.get(id)?.alive)
  let remaining = amount
  for (let pass = 0; pass < 5 && remaining > 1e-9; pass++) {
    const eligible = weighted.filter(([id]) => world.actors.get(id)!.hp < world.actors.get(id)!.attrs.maxHp)
    const total = eligible.reduce((s,[,w]) => s+w,0); if (total <= 0) break
    const budget = remaining
    for (const [id,weight] of eligible) { const a=world.actors.get(id)!, healed=Math.min(a.attrs.maxHp-a.hp,budget*weight/total); a.hp+=healed;remaining-=healed }
  }
}
export function updateCoopRevives(world: World): void {
  if (!world.coop || world.gameOver) return
  const online = onlineMembers(world), living = online.map((m)=>world.actors.get(m.id)!).filter((a)=>a.alive)
  if (!online.length) { world.paused=true; return }
  if (!living.length) { world.gameOver=true; return }
  for (const member of online) {
    const actor=world.actors.get(member.id)!
    if (actor.alive || member.reviveTicks <= 0 || --member.reviveTicks > 0) continue
    const anchor = living[0]!, candidates = [anchor.pos,world.room.entry]
    let pos = resolveSpawnPosition(world.room.entry,actor.radius,world.room.walls,world.room.bounds)
    for (const candidate of candidates) for (const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
      const point=resolveSpawnPosition({x:candidate.x+Math.cos(angle)*(actor.radius+anchor.radius+30),y:candidate.y+Math.sin(angle)*(actor.radius+anchor.radius+30)},actor.radius,world.room.walls,world.room.bounds)
      const safe = ![...world.actors.values()].some((a)=>a.alive&&a.team!=='player'&&distance(a.pos,point)<a.radius+actor.radius+100) && !world.mines.some((m)=>m.team!=='player'&&distance(m.pos,point)<m.blastRadius) && !world.projectiles.some((p)=>p.team!=='player'&&distance(p.pos,point)<100)
      if (safe && hasLineOfSight(candidate,point,world.room.walls)) { pos=point;break }
    }
    actor.pos={...pos};actor.alive=true;actor.hp=Math.max(1,actor.attrs.maxHp*0.5);actor.shield=0;actor.iframesTicks=120;actor.outOfCombatTicks=0;actor.burn=undefined;actor.shockTicks=0
    actor.laserTicks=0;actor.burstRemaining=0;actor.intent={move:{x:0,y:0},fire:false};world.effects.push({kind:'revive',x:pos.x,y:pos.y,radius:80,ttl:30})
  }
}
