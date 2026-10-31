import { createCardRegistry } from '../core/cards'
import type { AttrKey, AttrSet } from '../core/attrs'
import type { Card, Requirement } from '../core/cards'
import { CARD_ECONOMY, DEFLECT_RULES, DROP_RULES, MINE_RULES, WEAPON_RULES, homingProfile, penetrationProfile } from '../core/rules'
import { TICK_RATE } from '../core/types'
import { formatRuleNumber as fmt } from './format'
import { describeRage, describeDash } from './skills'
import { PLAYER_BASE_ATTRS } from './player'
import { CARD_PURPOSES } from './cardRoles'

/** Numeric operations are the single source for both effects and descriptions. */
type Operation = 'add' | 'multiply' | 'divide' | 'set' | 'chance'
type Modifier = readonly [key: AttrKey, operation: Operation, value: number, label: string, percent?: boolean]
type Formula = (level: number) => readonly Modifier[]
type Options = Partial<Pick<Card, 'priority' | 'resellable' | 'maxLevel' | 'requires' | 'tags' | 'unavailable'>> & {
  readonly enabled?: (attrs: AttrSet) => boolean
  readonly describe?: (level: number, modifiers: readonly Modifier[], generated: string) => string
}
export function cardPrice(base: number, level: number): number { return Math.round(base * CARD_ECONOMY.growth ** (level - 1)) }
function describeModifier([, operation, value, label, percent]: Modifier): string {
  const shown = percent ? `${fmt(value * 100)}%` : fmt(value)
  return operation === 'chance' ? `${label} ${shown}` : operation === 'set' ? `${label} ${shown}` :
    operation === 'add' ? `${label} ${value >= 0 ? '+' : ''}${shown}` : `${label} ${operation === 'divide' ? '÷' : '×'}${shown}`
}
function formulaCard(id: string, name: string, category: Card['category'], cost: number, formula: Formula, options: Options = { priority: 100 }): Card {
  const { describe, enabled, ...metadata } = options
  return { id, name, category, priority: 100, priceFn: (level) => cardPrice(cost, level), ...metadata, resellable: true,
    effectFn: (level, attrs) => {
      const next = { ...attrs }
      if (enabled && !enabled(attrs)) return next
      for (const [key, operation, value] of formula(level)) {
        next[key] = operation === 'add' ? next[key] + value : operation === 'multiply' ? next[key] * value :
          operation === 'divide' ? next[key] / value : operation === 'chance' ? 1 - (1 - next[key]) * (1 - value) : value
      }
      next.maxHp = Math.max(1, next.maxHp); next.armor = Math.max(0, next.armor)
      return next
    },
    summary: (level) => {
      const modifiers = formula(level), text = modifiers.filter(([, op, value, label]) => label && (op !== 'add' || value !== 0)).map(describeModifier).join(' · ')
      return (describe ? describe(level, modifiers, text) : text) + ' · 可回收'
    },
  }
}
function attrCard(id: string, name: string, category: Card['category'], cost: number, key: AttrKey, perLevel: number, label: string,
  priority: number, percent = false, requires?: readonly Requirement[]): Card {
  const per = percent ? `${fmt(perLevel * 100)}%` : fmt(perLevel)
  return formulaCard(id, name, category, cost, (level) => [[key, 'add', perLevel * level, label, percent]], {
    priority, requires, describe: (_level, _modifiers, generated) => `${generated}（每级 +${per}）`,
  })
}
function numericCard(id: string, name: string, category: Card['category'], cost: number,
  modifiers: readonly Modifier[], tags: readonly string[], resellable = false, requires?: readonly Requirement[], priority = 100): Card {
  return formulaCard(id, name, category, cost, (level) => modifiers.map(([key, operation, value, label, percent]) =>
    [key, operation, operation === 'multiply' ? value ** level : value * level, label, percent] as const), { priority, tags, resellable, requires })
}
function toggle(id: string, name: string, category: Card['category'], cost: number, key: AttrKey, detail: () => string,
  requires?: readonly Requirement[], priority = 100): Card {
  return formulaCard(id, name, category, cost, () => [[key, 'set', 1, name]], {
    priority, maxLevel: 1, resellable: true, requires, tags: ['机制', '可回收'], describe: detail,
  })
}
const noSniper = (attrs: AttrSet) => attrs.maxProjectiles === 1 ? '狙击手仅允许一颗子弹，此卡整卡暂停' : null
export const CARDS: readonly Card[] = [
  attrCard('gun-damage', '弹头强化', 'gun', 10, 'damage', 2, '伤害', 10),
  attrCard('gun-firerate', '循环加速', 'gun', 12, 'fireRate', 0.2, '射速', 10),
  attrCard('gun-bulletspeed', '高速装药', 'gun', 8, 'bulletSpeed', 90, '弹速', 10),
  attrCard('gun-range', '加长枪管', 'gun', 6, 'range', 70, '射程', 10),
  attrCard('gun-pierce', '穿透弹', 'gun', 20, 'pierce', 1, '穿透层数', 10),
  attrCard('gun-size', '宽幅弹芯', 'gun', 6, 'bulletSize', 2, '弹体半径', 10),
  attrCard('gun-penetration', '相位穿甲', 'gun', 12, 'penetration', 30, '护甲穿透', 10),
  attrCard('gun-inner', '核心透镜', 'gun', 12, 'innerDamageMult', 0.3, '内层伤害倍率', 10, false, [{ card: 'gun-pierce', level: 1 }]),
  attrCard('armor', '复合装甲', 'defense', 12, 'armor', 15, '护甲', 20),
  attrCard('maxhp', '强化骨架', 'defense', 10, 'maxHp', 10, '最大生命', 20),
  formulaCard('shield', '棱光护盾', 'defense', 16, (level) => [['shield', 'add', 12 * level, '护盾值'], ['shieldCapMult', 'add', 0.25 * level, '护盾上限系数']], { priority: 20 }),
  attrCard('shard-gain', '棱晶共鸣', 'special', 20, 'shardGain', 0.15, '棱晶收益', 5, true),
  attrCard('lifesteal', '生命虹吸', 'recovery', 20, 'lifesteal', 0.03, '吸血', 30, true),
  formulaCard('shield-steal', '护盾虹吸', 'recovery', 18, (level) => [['shieldSteal', 'add', 0.04 * level, '吸盾', true]], { priority: 30, requires: [{ card: 'shield', level: 1 }], enabled: (attrs) => attrs.shield > 0, describe: (_n, _m, text) => `${text}；需激活护盾，回复不超过护盾上限` }),
  attrCard('revive', '备用核心', 'special', 60, 'revives', 1, '复活次数', 40),
  formulaCard('deflect', '偏转力场', 'skill', 26, (level) => [
    ['deflectLevel', 'set', 1, ''], ['deflectWindowSeconds', 'add', 0.04 * (level - 1), '主动窗口加成/秒'],
    ['deflectFieldRadius', 'add', 220 + 40 * (level - 1), '力场半径'], ['deflectFieldStrength', 'add', 600 + 220 * (level - 1), '力场强度'],
  ], { priority: 50, describe: (_level, _modifiers, text) => `${text}；基础窗口 ${fmt(PLAYER_BASE_ATTRS.deflectWindowSeconds)} 秒；主动期间力场 ×${fmt(DEFLECT_RULES.activeForceMultiplier)} 并夺回接触的子弹` }),
  formulaCard('reflect', '棱镜回击', 'skill', 32, (level) => [
    ['deflectLevel', 'set', 2, ''], ['deflectWindowSeconds', 'add', 0.05 * level, '主动窗口加成/秒'],
    ['reflectDamageMult', 'add', 0.5 * level, '反射伤害倍率'], ['deflectFieldRadius', 'add', 30 * level, '力场半径'], ['deflectFieldStrength', 'add', 100 * level, '力场强度'],
  ], { priority: 60, requires: [{ card: 'deflect', level: 1 }], describe: (_level, _modifiers, text) => `强化回击；${text}` }),
]
export const BUILD_CARDS: readonly Card[] = [
  toggle('auto-aim', '自动索敌', 'special', 12, 'autoAim', () => '启用自动瞄准：优先手动锁定，否则沿攻击方向选目标', undefined, 0),
  toggle('auto-fire', '自动扳机', 'special', 12, 'autoFire', () => '启用自动射击；设置中可切回手动', undefined, 0),
  formulaCard('burst', '脉冲连发', 'gun', 26, (level) => [
    ['burstCount', 'add', level, '连发轮数'], ['damage', 'divide', 1 + 0.2 * level, '伤害'], ['range', 'divide', 1 + 0.1 * level, '射程'],
  ], { priority: 110, unavailable: noSniper, enabled: (attrs) => attrs.maxProjectiles !== 1, tags: ['连发'], describe: (_level, _modifiers, text) => `${text}；同一朝向，间隔 ${fmt(WEAPON_RULES.burstGapTicks / TICK_RATE)} 秒；与霰弹弹数相乘；狙击手生效时整卡暂停（含代价）` }),
  formulaCard('scatter', '棱光霰弹', 'gun', 32, (level) => [
    ['multishot', 'add', 2 * level, '每轮弹数'], ['bulletSpeed', 'divide', 1 + 0.12 * level, '弹速'], ['damage', 'divide', 1 + 0.14 * level, '伤害'],
  ], { priority: 110, unavailable: noSniper, enabled: (attrs) => attrs.maxProjectiles !== 1, tags: ['霰弹'], describe: (_level, _modifiers, text) => `${text}；多方向发射；狙击手生效时整卡暂停（含代价）` }),
  toggle('ricochet', '镜面弹射', 'gun', 26, 'ricochet', () => '每次撞墙消耗 1 穿透；至少保留 1 穿透继续飞行', [{ card: 'gun-pierce', level: 1 }]),
  formulaCard('homing', '追踪弹芯', 'gun', 32, (level) => [['homing', 'add', level, '追踪等级'], ['range', 'divide', 1 + 0.2 * Math.sqrt(level), '射程']], {
    priority: 100, tags: ['追踪', '飞剑'], describe: (level, _modifiers, text) => {
      const p = homingProfile(level)
      return `${text}；初速 ×${fmt(p.initialMultiplier)}，加速至 ×${fmt(p.cruiseMultiplier)}；转速 ${fmt(p.turnRate)} 弧度/秒`
    },
  }),
  formulaCard('suspension', '悬浮弹芯', 'gun', 14, (level) => [
    ['bulletSpeed', 'divide', 1 + 0.3 * level, '弹速'], ['range', 'multiply', 1 + 0.15 * level, '射程'],
  ], {
    priority: 100, resellable: true, tags: ['飞剑', '追踪', '可回收'], describe: (_level, _modifiers, text) => `${text}；延长飞行路径，配合追踪形成飞剑`,
  }),
  formulaCard('pierce-drive', '贯穿推进', 'gun', 24, (level) => [['pierceBoost', 'add', level, '贯穿推进等级']], {
    priority: 100, tags: ['穿透', '飞剑'], requires: [{ card: 'gun-pierce', level: 1 }], describe: (level) => {
      const p = penetrationProfile(level)
      return `每次穿过单位后若仍有穿透：弹速与最高弹速 ×${fmt(p.speedMultiplier)}，剩余射程 +${fmt(p.rangeGain)}`
    },
  }),
  formulaCard('explosive', '裂晶弹头', 'gun', 28, (level) => [['blastRadius', 'add', 75 * level, '爆炸半径'], ['damage', 'divide', 1 + 0.06 * level, '伤害']], { priority: 100, tags: ['爆破'] }),
  numericCard('coward', '胆小鬼', 'mobility', 18, [['speed', 'multiply', 1.25, '移速'], ['maxHp', 'multiply', 0.8, '最终最大生命']], ['机动', '可回收'], true, undefined, 1000),
  numericCard('heavy-stance', '重炮手', 'gun', 28, [['speed', 'multiply', 0.85, '移速'], ['armor', 'add', 30, '护甲'], ['damage', 'multiply', 1.35, '伤害']], ['重炮', '可回收'], true),
  numericCard('glass-cannon', '玻璃大炮', 'gun', 30, [['damage', 'multiply', 1.4, '伤害'], ['fireRate', 'multiply', 1.3, '攻速'], ['maxHp', 'multiply', 0.7, '最终最大生命']], ['高风险', '可回收'], true, undefined, 1000),
  formulaCard('precision-stance', '狙击手', 'gun', 36, (level) => [
    ['damage', 'multiply', 1 + 0.45 * level, '伤害'], ['range', 'multiply', 1 + 0.6 * level, '射程'], ['bulletSpeed', 'multiply', 1 + 2 * level, '弹速'],
    ['maxProjectiles', 'set', 1, '自有子弹上限'],
  ], { priority: 100, resellable: true, tags: ['精准', '可回收'], describe: (_level, _modifiers, text) => `${text}；高速弹转弯半径更大；连发与霰弹整卡暂停；破片也受一弹限制` }),
  formulaCard('ascender', '广角棱镜', 'special', 12, (level) => [['vision', 'multiply', 1 + 0.12 * level, '可见世界范围']], { priority: 100, tags: ['视野'] }),
  numericCard('mine-power', '聚变雷芯', 'mine', 12, [['mineDamage', 'add', 8, '地雷伤害']], ['雷场']),
  numericCard('mine-radius', '扩域雷场', 'mine', 20, [['mineBlastRadius', 'add', 25, '爆炸半径'], ['mineTriggerRadius', 'add', 15, '侦测半径'], ['mineSlowRadius', 'add', 20, '减速半径']], ['雷场']),
  numericCard('mine-cooldown', '快速布雷', 'mine', 16, [['mineCooldownRate', 'multiply', 1.2, '布雷冷却速度']], ['雷场']),
  numericCard('mine-stock', '雷阵矩阵', 'mine', 16, [['mineLimit', 'add', 2, '地雷上限']], ['雷场']),
  numericCard('mine-slow', '蛛网', 'mine', 14, [['mineSlowMultiplier', 'add', 0.5, '减速倍率']], ['雷场']),
  toggle('mine-ignore', '绝缘雷壳', 'mine', 12, 'mineIgnoreBullets', () => `子弹不会触发或击毁地雷；减速倍率高于 1 的部分只保留 ${fmt(MINE_RULES.ignoreSlowFactor * 100)}%`),
  formulaCard('miner', '掘金者', 'mine', 20, (level) => [['mineShardChance', 'chance', 1 - 0.8 ** level, '晶片掉落概率', true]], {
    priority: 100, tags: ['经济', '拾取'], describe: (_level, _modifiers, text) => `${text}；地雷有效伤害触发，拾取 +${fmt(DROP_RULES.shardValue)} 基础棱晶；拾取时受拾取者的收益倍率影响`,
  }),
  toggle('grenade', '手榴弹', 'mine', 20, 'grenade', () => `沿释放时移动方向以 ${fmt(MINE_RULES.grenadeSpeed)}/秒前进 ${fmt(MINE_RULES.grenadeTravel)} 距离后引爆；静止时沿枪口`),
  numericCard('sluggish', '延时引信', 'mine', 12, [['mineHp', 'add', 12, '本体生命'], ['mineFuseSeconds', 'add', 0.25, '引爆延迟/秒']], ['手雷'], false, [{ card: 'grenade', level: 1 }]),
  numericCard('shrapnel', '破片', 'mine', 28, [['mineFragments', 'add', 4, '爆炸碎片弹数']], ['手雷', '弹道']),
  formulaCard('gourmet', '美食家', 'recovery', 18, (level) => [['bloodOrbChance', 'chance', 1 - 0.85 ** level, '血球掉落概率', true]], {
    priority: 100, tags: ['拾取', '续航'], describe: (_level, _modifiers, text) => `${text}；子弹有效伤害触发，回复至少 ${fmt(DROP_RULES.bloodMinimum)} 生命或最大生命 ${fmt(DROP_RULES.bloodHpFraction * 100)}%`,
  }),
  formulaCard('magnet', '磁吸核心', 'special', 12, (level) => [['pickupRadius', 'add', 100 + 80 * level, '自动吸取半径']], {
    priority: 100, tags: ['拾取'], describe: (_level, _modifiers, text) => `${text}；设置中可开关，靠近仍可手动拾取`,
  }),
  formulaCard('shield-regen', '护盾回充', 'recovery', 18, (level) => [['shieldRegen', 'add', 3 * level, '护盾回复/秒']], { priority: 30, requires: [{ card: 'shield', level: 1 }], enabled: (attrs) => attrs.shield > 0, tags: ['护盾'], describe: (_n, _m, text) => `${text}；需激活护盾，脱战后回复` }),
  numericCard('thruster', '矢量推进', 'mobility', 10, [['speed', 'add', 25, '移速']], ['机动']),
  numericCard('greed', '棱晶契约', 'special', 26, [['shardGain', 'multiply', 1.3, '收益'], ['maxHp', 'multiply', 0.9, '最终生命']], ['经济', '高风险'], false, undefined, 1000),
  formulaCard('rage', '狂暴', 'skill', 32, (level) => [['rageLevel', 'add', level, '狂暴等级']], { priority: 50, tags: ['主动'], describe: (level) => describeRage(level) }),
  formulaCard('dash', '冲刺', 'skill', 18, (level) => [['dashLevel', 'add', level, '冲刺等级']], { priority: 50, tags: ['主动'], describe: (level) => describeDash(level) }),
  formulaCard('skill-cycle', '冷却回路', 'skill', 20, (level) => [['skillCooldownRate', 'multiply', 1.18 ** level, '所有技能冷却速度']], { priority: 100, tags: ['主动'], unavailable: (attrs) => attrs.deflectLevel > 0 || attrs.rageLevel > 0 || attrs.dashLevel > 0 ? null : '需要先拥有至少一种主动技能' }),
]
export const ALL_CARDS: readonly Card[] = [...BUILD_CARDS.slice(0, 2), ...CARDS, ...BUILD_CARDS.slice(2)].map((card) => ({ ...card, purpose: CARD_PURPOSES[card.id] }))
export const LEGACY_V3_REGISTRY = createCardRegistry(ALL_CARDS)
