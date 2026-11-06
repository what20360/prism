import { armorToMitigation, shieldCap, type AttrSet } from '../core/attrs'
import { TICK_RATE } from '../core/types'
import { resolveAttrs } from '../core/cards'
import { CARD_REGISTRY } from '../content/cards'
import { PLAYER_BASE_ATTRS } from '../content/player'
import { formatNumber as f } from './cardInfo'
import { ELECTRIC_RULES, arcHopRange, arcProfile, ARSENAL_RULES, broodProfile, dashProfile, homingProfile, laserProfile, mineSlowMultiplier, penetrationProfile, pulseProfile, rageProfile, SNIPER_RULES, WEAPON_RULES } from '../core/rules'

export interface AttributeRow { id:string;label:string;value:string;base:string;changed:boolean;note?:string }
export interface AttributeBlock {id:string;rows:AttributeRow[];important:boolean;changed:boolean}
export interface AttributeGroup {id:string;title:string;blocks:AttributeBlock[]}
export interface RadarAxis {id:string;label:string;value:number;base:number;scale:number;unit:string}
export interface AttributeRadar {id:string;title:string;note:string;axes:RadarAxis[]}
export const weaponName=(weapon:number)=>['弹芯枪 · 物理','电弧 · 电伤','激光 · 热伤','狙击手 · 物理'][weapon]??'弹芯枪 · 物理'
/** Standard reference only; this never replaces a character's resolved attributes. */
export function attributeReference(weapon:number):AttrSet {
 const id=weapon===1?'weapon-electric':weapon===2?'weapon-laser':weapon===3?'precision-stance':null
 return resolveAttrs(PLAYER_BASE_ATTRS,id?[{id,level:1}]:[],CARD_REGISTRY)
}
/** An independent saturating scale per axis. No upgrade cap or combined combat score. */
export function radarRatio(value:number,scale:number):number {
 if(!Number.isFinite(value)||value<=0||!Number.isFinite(scale)||scale<=0)return 0
 return 1/(1+scale/value)
}
export function weaponMetrics(a:AttrSet){
 const physical=a.weapon===0||a.weapon===3,laser=a.weapon===2
 const duration=laser?Math.max(1,Math.round(ARSENAL_RULES.laserTicks*a.burstCount))/60:physical?Math.max(0,Math.floor(a.burstCount)-1)*WEAPON_RULES.burstGapTicks/60:0
 const cooldown=a.fireRate>0?Math.max(1,Math.round(TICK_RATE/a.fireRate))/TICK_RATE:Infinity
 const cycle=cooldown+duration
 const damage=laser?a.damage*ARSENAL_RULES.laserDamage*laserProfile(a.laserPower).damageMultiplier:a.weapon===1?a.damage*arcProfile(a.arcEfficiency).damageMultiplier:a.damage
 return {coverage:Math.max(1,Math.floor(a.multishot))*(physical?Math.max(1,Math.floor(a.burstCount)):1),energyRays:Math.min(64,Math.max(1,Math.floor(a.multishot))),arcDepth:Math.min(64,Math.max(1,Math.floor(a.burstCount)),Math.max(1,Math.floor(a.pierce))),cooldown,damage,range:a.range*(laser?ARSENAL_RULES.laserRange:1),duration,cycle,frequency:1/cycle,
  pulseCount:Math.ceil(Math.max(1,Math.round(ARSENAL_RULES.laserTicks*a.burstCount))/ARSENAL_RULES.laserGap),
  fullSpeedDamage:a.damage+a.bulletSpeed*SNIPER_RULES.impactPerSpeed*a.sniperPower*a.damageScale}
}
const percent=(n:number)=>`${f(n*100)}%`,seconds=(n:number)=>`${f(n)} 秒`,rate=(n:number)=>`${f(n)} /秒`,mult=(n:number)=>`×${f(n)}`
const different=(a:number,b:number)=>Math.abs(a-b)>1e-7*Math.max(1,Math.abs(a),Math.abs(b))
export function createAttributeModel(attrs:AttrSet){
 const a=attrs,b=attributeReference(a.weapon),m=weaponMetrics(a),bm=weaponMetrics(b),physical=a.weapon===0||a.weapon===3
 const groups:AttributeGroup[]=[]
 const makeGroup=(id:string,title:string)=>{const group:AttributeGroup={id,title,blocks:[]};groups.push(group);return group}
 const block=(g:AttributeGroup,id:string,important:boolean,rows:AttributeRow[])=>{if(rows.length)g.blocks.push({id,important,changed:rows.some(r=>r.changed),rows})}
 const value=(id:string,label:string,n:number,base:number,fmt:(n:number)=>string=f,note?:string):AttributeRow=>({id,label,value:fmt(n),base:fmt(base),changed:different(n,base),note})
 const attr=(id:keyof AttrSet,label:string,fmt:(n:number)=>string=f,note?:string)=>value(id,label,a[id],b[id],fmt,note)
 const toggle=(id:keyof AttrSet,label:string,note?:string)=>attr(id,label,n=>n>0?'已装配':'未装配',note)
 const offense=makeGroup('offense','武器与输出')
 block(offense,'damage',true,[value('hitDamage',a.weapon===2?'每脉冲伤害':a.weapon===1?'等效单发伤害':'单发基础伤害',m.damage,bm.damage,f,a.weapon===1?'持续供能的单发等效参考；实际按供能时间分配伤害和格挡，不含多余穿透增伤。':'未扣目标格挡、护甲、抗性或核心倍率。'),...(a.weapon===3&&a.sniperPower>0?[value('kineticHit','满速命中伤害',m.fullSpeedDamage,bm.fullSpeedDamage,f,'按当前最高弹速估算；真实命中取当时弹速，贯穿推进可进一步提高。'),attr('sniperPower','动能狙击等级')]:[]),...(different(a.damageScale,b.damageScale)?[attr('damageScale','通用伤害倍率',mult)]:[])])
 block(offense,'cadence',true,a.weapon===1?[attr('fireRate','等效供能频率',rate),value('electricPower','基础电伤功率',m.damage*m.frequency,bm.damage*bm.frequency,rate,'未扣目标减伤，不含分叉/多余穿透增伤；攻速提高功率，不是点击发射次数。'),value('electricRefresh','电流刷新间隔',ELECTRIC_RULES.pulseTicks/TICK_RATE,ELECTRIC_RULES.pulseTicks/TICK_RATE,seconds)]:[attr('fireRate','基础攻速',rate,'持续攻击结束后开始冷却；一弹上限和索敌也可能限制实际频率。'),value('cooldown','攻击结束后冷却',m.cooldown,bm.cooldown,n=>Number.isFinite(n)?seconds(n):'无法开火'),...(m.duration>0?[value('attackDuration',a.weapon===2?'持续照射':'连发持续时间',m.duration,bm.duration,seconds),value('cycleFrequency','周期频率（估算）',m.frequency,bm.frequency,rate,'含本次持续攻击和后续冷却，按逻辑帧估算，不等于实际DPS。')]:[])])
 block(offense,'salvo',false,[physical?attr('multishot','每轮散射弹数'):value('multishot',a.weapon===1?'最大独立电弧起点数':'最大激光束数',m.energyRays,bm.energyRays,f,'每次最多64路；实际命中数量取决于目标和遮挡。'),...(physical&&a.burstCount>1?[attr('burstCount','同向连发轮数')]:[])])
 if(a.penetration>0||physical)block(offense,'armorHit',false,[attr('penetration','护甲穿透'),...(physical?[attr('innerDamageMult','核心命中倍率',mult)]:[])])
 const path=makeGroup('trajectory',physical?'弹道与命中':'射程与传递')
 block(path,'reach',true,[value('range','有效射程（距离）',m.range,bm.range),attr('pierce',a.weapon===1?'每条树穿透预算':'穿透层数',f,a.weapon===1?'每个命中消耗一层，每条电弧树独立。':undefined)])
 if(physical){
  const h=homingProfile(a.homing),hb=homingProfile(b.homing)
  block(path,'velocity',true,[attr('bulletSpeed','最高弹速',rate),...(a.homing>0?[value('initialSpeed','发射初速',a.bulletSpeed*h.initialMultiplier,b.bulletSpeed*hb.initialMultiplier,rate),value('homingTurn','追踪转速',h.turnRate,hb.turnRate,n=>`${f(n)} 弧度/秒`),value('homingRecovery','恢复原速所需路径',a.range*0.5,b.range*0.5)]:[])])
  if(a.pierceBoost>0)block(path,'drive',false,[attr('pierceBoost','贯穿推进等级'),value('driveSpeed','每次贯穿加速',penetrationProfile(a.pierceBoost).speedMultiplier,1,mult),value('driveRange','每次贯穿增程',penetrationProfile(a.pierceBoost).rangeGain,0)])
  if(a.ricochet>0)block(path,'bounce',false,[toggle('ricochet','墙体弹射','每次消耗一层穿透。')])
  if(a.maxProjectiles>0)block(path,'limit',true,[attr('maxProjectiles','同时存在子弹上限',n=>`${f(n)} 颗`,'包括自身破片和反射夺回的子弹；达到上限时不能发射。')])
  if(a.blastRadius>0)block(path,'blast',false,[attr('blastRadius','弹丸爆炸半径')])
  block(path,'size',false,[attr('bulletSize','弹丸碰撞半径')])
 }else if(a.weapon===1){
  const arc=arcProfile(a.arcEfficiency),base=arcProfile(b.arcEfficiency)
  block(path,'arc',true,[value('hopRange','每跳传导距离',arcHopRange(a.range),arcHopRange(b.range)),value('burstCount','传递层数上限（含首击）',m.arcDepth,bm.arcDepth,f,'受连发和穿透预算共同限制，最多64层；实际深度取决于目标分布。'),value('arcRetention','每层伤害保留',arc.retention,base.retention,percent),value('arcBoostedRetention','强化层伤害保留',arc.boostedRetention,base.boostedRetention,percent)])
  if(a.arcEfficiency>0)block(path,'coil',false,[attr('arcEfficiency','电容绕组等级')])
 }else{
  block(path,'laser',true,[value('pulseCount','每束脉冲次数',m.pulseCount,bm.pulseCount),value('pulseGap','脉冲间隔',ARSENAL_RULES.laserGap/60,ARSENAL_RULES.laserGap/60,seconds)])
  if(a.laserPower>0)block(path,'focus',false,[attr('laserPower','聚焦透镜等级'),value('laserSpread','光束散射角间隔',laserProfile(a.laserPower).spreadStep,laserProfile(b.laserPower).spreadStep,n=>`${f(n*180/Math.PI)}°`)])
  if(a.ricochet>0)block(path,'laserBounce',false,[toggle('ricochet','激光折射','撞墙消耗穿透并反射，瞬发光路仍受射程限制。')])
 }
 const survival=makeGroup('survival','生命、护盾与防御')
 block(survival,'life',true,[attr('maxHp','最大生命'),...(a.lifesteal>0?[attr('lifesteal','伤害吸血',percent)]:[]),...(a.revives>0?[attr('revives','备用复活次数')]:[])])
 block(survival,'armor',true,[attr('armor','护甲'),value('mitigation','护甲减伤',armorToMitigation(a.armor),armorToMitigation(b.armor),percent)])
 if(a.shieldCapMult>0||shieldCap(a)>0)block(survival,'shield',true,[value('shieldCap','护盾上限',shieldCap(a),shieldCap(b)),attr('shieldCapMult','护盾系数',percent),attr('shieldRegen','脱战护盾回复',rate,'停止攻击且3秒未受伤后回复；禁盾期间不回复。')])
 if(a.block>0)block(survival,'block',false,[attr('block','每次固定格挡')])
 const resists=(['physicalResist','electricResist','heatResist'] as const).filter(k=>a[k]!==0)
 if(resists.length)block(survival,'resists',false,resists.map(k=>attr(k,{physicalResist:'物理抗性',electricResist:'电抗性',heatResist:'热抗性'}[k],f,'抗性点数，不是减伤百分比。')))
 const utility=makeGroup('utility','机动与资源')
 block(utility,'movement',true,[attr('speed','当前移动速度',rate,'含当前技能、减速与脱战修正。'),attr('vision','视野倍率',mult)])
 block(utility,'income',false,[attr('shardGain','棱晶收益',mult),...(a.pickupRadius>0?[attr('pickupRadius','磁铁吸取半径')]:[]),...(a.mineShardChance>0?[attr('mineShardChance','击杀掉片概率等级')]:[]),...(a.bloodOrbChance>0?[attr('bloodOrbChance','击杀血球概率等级')]:[])])
 if(a.autoAim>0||a.autoFire>0)block(utility,'automatic',false,[...(a.autoAim>0?[toggle('autoAim','自动索敌','已拥有；实际启停还需在设置选择。')]:[]),...(a.autoFire>0?[toggle('autoFire','自动扳机','已拥有；实际启停还需在设置选择。')]:[])])
 const mines=makeGroup('mines','雷场装备'),p=pulseProfile(a.minePulseLevel),pb=pulseProfile(b.minePulseLevel)
 block(mines,'mineMain',false,[value('minePulseDamage','每段爆炸伤害',a.mineDamage/p.divisor,b.mineDamage/pb.divisor),value('minePulses','爆炸段数',p.count,pb.count),attr('mineBlastRadius','爆炸半径'),value('mineCooldown','布雷冷却',a.mineCooldown/a.mineCooldownRate,b.mineCooldown/b.mineCooldownRate,seconds),attr('mineLimit','母雷数量上限')])
 block(mines,'mineField',false,[attr('mineTriggerRadius','侦测半径'),attr('mineSlowRadius','减速半径'),value('mineSlow','子弹减速倍率',mineSlowMultiplier(a.mineSlowMultiplier,a.mineIgnoreBullets>0),mineSlowMultiplier(b.mineSlowMultiplier,b.mineIgnoreBullets>0),n=>`÷${f(n)}`),attr('mineHp','雷体生命'),attr('mineFuseSeconds','引爆延迟',seconds)])
 if(a.grenade>0||a.mineFragments>0||a.mineIgnoreBullets>0)block(mines,'mineMechanisms',false,[...(a.grenade>0?[toggle('grenade','手榴弹移动')]:[]),...(a.mineFragments>0?[attr('mineFragments','爆炸破片数')]:[]),...(a.mineIgnoreBullets>0?[toggle('mineIgnoreBullets','不被子弹触发')]:[])])
 if(a.mineBroodLevel>0){const child=broodProfile(a.mineBroodLevel);block(mines,'brood',false,[value('children','每次子雷数量',child.children,0),value('inheritance','子雷属性继承',child.inherit,0,percent),value('childLimit','子雷独立上限',Math.floor(a.mineLimit*child.capMultiplier),0)])}
 const skills=makeGroup('skills','已解锁技能')
 if(a.deflectLevel>0)block(skills,'deflect',true,[attr('deflectLevel','偏转力场等级'),attr('deflectFieldRadius','力场半径'),attr('deflectFieldStrength','力场强度'),attr('deflectWindowSeconds','主动偏转窗口',seconds),value('deflectCd','偏转技能冷却',a.deflectCooldownSeconds/a.skillCooldownRate,b.deflectCooldownSeconds/b.skillCooldownRate,seconds),attr('reflectDamageMult','反射伤害倍率',mult)])
 for(const [key,label,profile]of [['rageLevel','狂暴',rageProfile],['dashLevel','冲刺',dashProfile]] as const)if(a[key]>0){const s=profile(a[key]);block(skills,key,true,[attr(key,`${label}等级`),value(key+'Duration',`${label}持续时间`,s.duration,s.duration,seconds),value(key+'Cooldown',`${label}冷却`,s.cooldown/a.skillCooldownRate,s.cooldown,seconds)])}
 const extra=makeGroup('geometry','碰撞与判定')
 block(extra,'geometry',false,[attr('radius','角色碰撞半径'),attr('coreRadiusMult','核心半径比例',percent),attr('chainCap','连杀收入上限')])
 const radars:AttributeRadar[]=[]
 const axis=(id:string,label:string,n:number,base:number,scale:number=base,unit=''):RadarAxis=>({id,label,value:n,base,scale:scale>0?scale:1,unit})
 radars.push({id:'weapon',title:'武器概览',note:a.weapon===1?'持续供能：功率按原伤害与攻速换算；格挡按时间分摊，不累加分叉伤害。':a.weapon===2?'脉冲与完整照射周期分别展示，不代表实战DPS。':'按完整齐射周期展示；命中、射程耗尽和一弹限制另行影响输出。',axes:[
  axis('damage',a.weapon===3&&a.sniperPower>0?'满速命中伤害':a.weapon===2?'脉冲伤害':a.weapon===1?'基础电伤功率':'单发伤害',a.weapon===3?m.fullSpeedDamage:a.weapon===1?m.damage*m.frequency:m.damage,a.weapon===3?bm.fullSpeedDamage:a.weapon===1?bm.damage*bm.frequency:bm.damage),
  axis('frequency',a.weapon===1?'等效供能频率':'周期频率',m.frequency,bm.frequency,bm.frequency,'/秒'),axis('range','有效射程',m.range,bm.range),axis('pierce',a.weapon===1?'树穿透预算':'穿透层数',a.pierce,b.pierce),
  a.weapon===1?axis('depth','传递层数上限',m.arcDepth,bm.arcDepth):a.weapon===2?axis('pulses','脉冲次数',m.pulseCount,bm.pulseCount):axis('velocity','最高弹速',a.bulletSpeed,b.bulletSpeed,b.bulletSpeed,'/秒'),
  axis('coverage',a.weapon===1?'电弧起点':a.weapon===2?'光束数量':'齐射总弹数',physical?m.coverage:m.energyRays,physical?bm.coverage:bm.energyRays)]})
 radars.push({id:'survival',title:'生存与机动',note:'护盾、护甲减伤和吸血的50%半径参考分别为50、50%、10%；其余取基础值。',axes:[axis('hp','最大生命',a.maxHp,b.maxHp),axis('shield','护盾上限',shieldCap(a),shieldCap(b),50),axis('armor','护甲减伤',armorToMitigation(a.armor),armorToMitigation(b.armor),0.5,'%'),axis('speed','当前移速',a.speed,b.speed,b.speed,'/秒'),axis('lifesteal','吸血',a.lifesteal,b.lifesteal,0.1,'%'),axis('vision','视野倍率',a.vision,b.vision,b.vision,'倍')]})
 if(mines.blocks.some(x=>x.changed))radars.push({id:'mines',title:'雷场概览',note:'总伤害为全部爆炸段之和，不含破片、子雷、目标减伤和连锁。',axes:[axis('damage','总爆炸伤害',a.mineDamage*p.count/p.divisor,b.mineDamage*pb.count/pb.divisor),axis('radius','爆炸半径',a.mineBlastRadius,b.mineBlastRadius),axis('stock','母雷上限',a.mineLimit,b.mineLimit),axis('frequency','布雷频率',a.mineCooldown>0?a.mineCooldownRate/a.mineCooldown:0,b.mineCooldownRate/b.mineCooldown,b.mineCooldownRate/b.mineCooldown,'/秒'),axis('slow','减速倍率',mineSlowMultiplier(a.mineSlowMultiplier,a.mineIgnoreBullets>0),mineSlowMultiplier(b.mineSlowMultiplier,b.mineIgnoreBullets>0)),axis('field','减速半径',a.mineSlowRadius,b.mineSlowRadius)]})
 return {weapon:weaponName(a.weapon),groups:groups.filter(g=>g.blocks.length),radars}
}
