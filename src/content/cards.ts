import { createCardRegistry } from '../core/cards'
import type { AttrKey } from '../core/attrs'
import type { Card, Requirement } from '../core/cards'

const GROWTH = 1.6

/** Price depends only on the purchase count (docs/requirements.md 5.3.1). */
function priceFor(base: number): (level: number) => number {
  return (level) => Math.round(base * Math.pow(GROWTH, level - 1))
}

const fmt = (value: number): string => String(Number(value.toFixed(3)))

/**
 * Cards that only shift one attribute share this factory, so the effect and its
 * tooltip text can never drift apart.
 */
function attrEffect(
  key: AttrKey,
  perLevel: number,
  label: string,
  unit: 'flat' | 'percent' = 'flat',
): Pick<Card, 'effectFn' | 'summary'> {
  const show = (value: number): string =>
    unit === 'percent' ? `${fmt(value * 100)}%` : fmt(value)

  return {
    effectFn: (level, attrs) => ({ ...attrs, [key]: (attrs[key] as number) + perLevel * level }),
    summary: (level) => `${label} +${show(perLevel * level)}（每级 +${show(perLevel)}）`,
  }
}

function atLeast(key: AttrKey, min: number): Requirement {
  return { attr: key, min }
}

export const CARDS: readonly Card[] = [
  {
    id: 'gun-damage',
    name: '弹头强化',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(10),
    ...attrEffect('damage', 2, '伤害'),
  },
  {
    id: 'gun-firerate',
    name: '循环加速',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(12),
    ...attrEffect('fireRate', 0.2, '射速'),
  },
  {
    id: 'gun-bulletspeed',
    name: '高速装药',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(8),
    ...attrEffect('bulletSpeed', 90, '弹速'),
  },
  {
    id: 'gun-range',
    name: '加长枪管',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(6),
    ...attrEffect('range', 70, '射程'),
  },
  {
    id: 'gun-pierce',
    name: '穿透弹',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(20),
    ...attrEffect('pierce', 1, '穿透层数'),
  },
  {
    id: 'gun-size',
    name: '扩口径',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(8),
    ...attrEffect('bulletSize', 1, '子弹大小'),
  },
  {
    id: 'gun-penetration',
    name: '破甲弹',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(14),
    ...attrEffect('penetration', 20, '护甲穿透'),
  },
  {
    id: 'gun-inner',
    name: '核心校准',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(18),
    ...attrEffect('innerDamageMult', 0.1, '内层伤害倍率'),
  },
  {
    id: 'armor',
    name: '复合装甲',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(14),
    ...attrEffect('armor', 10, '护甲'),
  },
  {
    id: 'maxhp',
    name: '强化骨架',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(8),
    ...attrEffect('maxHp', 10, '最大生命'),
  },
  {
    id: 'shield',
    name: '护盾模块',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(12),
    ...attrEffect('shield', 10, '护盾值'),
  },
  {
    id: 'shield-cap',
    name: '护盾上限',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(16),
    ...attrEffect('shieldCapMult', 0.25, '护盾上限系数'),
  },
  {
    id: 'shard-gain',
    name: '棱晶共鸣',
    category: 'special',
    priority: 5,
    priceFn: priceFor(20),
    ...attrEffect('shardGain', 0.1, '棱晶收益', 'percent'),
  },
  {
    id: 'lifesteal',
    name: '汲取',
    category: 'recovery',
    priority: 30,
    priceFn: priceFor(18),
    ...attrEffect('lifesteal', 0.02, '吸血', 'percent'),
    requires: [atLeast('shardGain', 1.1)],
  },
  {
    id: 'shield-steal',
    name: '吸盾',
    category: 'recovery',
    priority: 30,
    priceFn: priceFor(18),
    ...attrEffect('shieldSteal', 0.02, '吸盾', 'percent'),
    requires: [atLeast('shieldCapMult', 1.25)],
  },
  {
    id: 'revive',
    name: '备用核心',
    category: 'special',
    priority: 40,
    priceFn: priceFor(60),
    maxLevel: 2,
    ...attrEffect('revives', 1, '复活次数'),
  },
  {
    id: 'deflect',
    name: '偏转力场',
    category: 'skill',
    priority: 50,
    priceFn: priceFor(22),
    maxLevel: 4,
    effectFn: (level, attrs) => ({
      ...attrs,
      deflectLevel: Math.max(attrs.deflectLevel, 1),
      deflectWindowSeconds: attrs.deflectWindowSeconds + 0.05 * (level - 1),
      deflectFieldRadius: attrs.deflectFieldRadius + 220 + 40 * (level - 1),
      deflectFieldStrength: attrs.deflectFieldStrength + 600 + 150 * (level - 1),
    }),
    summary: (level) =>
      level <= 1
        ? '力场半径 220、强度 600；主动窗口 0.25 秒：力场 ×5 并把接触的子弹转为己方'
        : '力场半径 +40、强度 +150、主动窗口 +0.05 秒',
    requires: [atLeast('armor', 20)],
  },
  {
    id: 'reflect',
    name: '反射',
    category: 'skill',
    priority: 60,
    priceFn: priceFor(40),
    maxLevel: 2,
    effectFn: (level, attrs) => ({
      ...attrs,
      deflectLevel: 2,
      deflectWindowSeconds: attrs.deflectWindowSeconds + 0.05 * level,
      reflectDamageMult: attrs.reflectDamageMult + 0.5 * level,
      deflectFieldRadius: attrs.deflectFieldRadius + 30 * level,
      deflectFieldStrength: attrs.deflectFieldStrength + 100 * level,
    }),
    summary: (level) =>
      `反射伤害倍率 +${fmt(0.5 * level)}、力场半径 +${30 * level}、强度 +${100 * level}、窗口 +${fmt(0.05 * level)} 秒`,
    requires: [{ card: 'deflect', level: 1 }, atLeast('armor', 50)],
  },
]

type Modifier = readonly [AttrKey, 'add' | 'multiply', number, string]

function buildCard(id: string, name: string, category: Card['category'], cost: number,
  modifiers: readonly Modifier[], tags: readonly string[], resellable = false,
  requires?: readonly Requirement[]): Card {
  return {
    id, name, category, tags, priority: 100, priceFn: priceFor(cost),
    maxLevel: resellable ? 1 : undefined, resellable, requires,
    effectFn: (level, attrs) => {
      const next = { ...attrs }
      for (const [key, op, value] of modifiers) {
        next[key] = op === 'add' ? next[key] + value * level : next[key] * value ** level
      }
      next.armor = Math.max(0, next.armor)
      next.maxHp = Math.max(1, next.maxHp)
      return next
    },
    summary: (level) => modifiers.map(([, op, value, label]) =>
      op === 'add' ? `${label} ${value >= 0 ? '+' : ''}${fmt(value * level)}` :
        `${label} ×${fmt(value ** level)}`).join(' · '),
  }
}

/** Named mechanism cards use explicit descriptions generated alongside their rules. */
function mechanism(id: string, name: string, category: Card['category'], cost: number,
  effectFn: Card['effectFn'], summary: NonNullable<Card['summary']>, tags: readonly string[],
  options: Pick<Card, 'resellable' | 'maxLevel' | 'requires' | 'priority'> = { priority: 100 }): Card {
  return { id, name, category, priceFn: priceFor(cost), effectFn, summary, tags, ...options }
}
export const BUILD_CARDS: readonly Card[] = [
  { id: 'auto-aim', name: '自动索敌', category: 'special', priority: 0, priceFn: priceFor(12), maxLevel: 1, resellable: true, tags: ['操控'],
    effectFn: (_level, attrs) => ({ ...attrs, autoAim: 1 }), summary: () => '启用自动瞄准：优先手动锁定，否则沿攻击方向选目标 · 可回收' },
  { id: 'auto-fire', name: '自动扳机', category: 'special', priority: 0, priceFn: priceFor(12), maxLevel: 1, resellable: true, tags: ['操控'],
    effectFn: (_level, attrs) => ({ ...attrs, autoFire: 1 }), summary: () => '启用自动射击；设置中可切回手动 · 可回收' },
  mechanism('burst', '连发', 'gun', 26, (level, a) => ({ ...a, burstCount: a.burstCount + level, damage: a.damage / (1 + 0.2 * level), range: a.range / (1 + 0.1 * level) }),
    (level) => `每次连发 ${1 + level} 轮；同一朝向，间隔 0.067 秒；伤害 ÷${fmt(1 + 0.2 * level)}，射程 ÷${fmt(1 + 0.1 * level)}；与霰弹弹数相乘`, ['连发']),
  mechanism('scatter', '霰弹', 'gun', 32, (level, a) => ({ ...a, multishot: a.multishot + 2 * level, bulletSpeed: a.bulletSpeed / (1 + 0.12 * level), damage: a.damage / (1 + 0.14 * level) }),
    (level) => `每轮弹数 +${2 * level}；初速 ÷${fmt(1 + 0.12 * level)}，伤害 ÷${fmt(1 + 0.14 * level)}；多方向发射`, ['霰弹']),
  mechanism('ricochet', '弹射', 'gun', 26, (_level, a) => ({ ...a, ricochet: 1 }),
    () => '每次撞墙消耗 1 穿透；至少保留 1 穿透继续飞行 · 可回收', ['弹道', '可回收'],
    { priority: 100, resellable: true, maxLevel: 1, requires: [{ card: 'gun-pierce', level: 1 }] }),
  mechanism('homing', '追踪', 'gun', 32, (level, a) => ({ ...a, homing: a.homing + level, range: a.range / (1 + 0.2 * level) }),
    (level) => `初速 ×0.6，逐渐加速至 ×1.5；射程 ÷${fmt(1 + 0.2 * level)}；向锁定目标偏转，转速 ${fmt(2.5 + 0.25 * level)} 弧度/秒`, ['追踪'],
    { priority: 100 }),
  buildCard('explosive', '星爆弹头', 'gun', 32, [['blastRadius', 'add', 45, '爆炸半径'], ['damage', 'multiply', 0.94, '伤害']], ['爆破']),
  mechanism('coward', '胆小鬼', 'mobility', 22, (_level, a) => ({ ...a, speed: a.speed * 1.25, maxHp: a.maxHp * 0.8 }),
    () => '移速 ×1.25；最终最大生命 ×0.80 · 可回收', ['机动', '可回收'], { priority: 1000, maxLevel: 1, resellable: true }),
  mechanism('heavy-stance', '重炮手', 'gun', 28, (_level, a) => ({ ...a, speed: a.speed * 0.85, armor: a.armor + 30, damage: a.damage * 1.35 }),
    () => '移速 ×0.85；护甲 +30、伤害 ×1.35 · 可回收', ['重炮', '可回收'], { priority: 100, maxLevel: 1, resellable: true }),
  mechanism('glass-cannon', '玻璃大炮', 'gun', 30, (_level, a) => ({ ...a, damage: a.damage * 1.35, fireRate: a.fireRate * 1.25, maxHp: a.maxHp * 0.7 }),
    () => '伤害 ×1.35、攻速 ×1.25；最终最大生命 ×0.70 · 可回收', ['高风险', '可回收'], { priority: 1000, maxLevel: 1, resellable: true }),
  mechanism('precision-stance', '狙击手', 'gun', 28, (_level, a) => ({ ...a, range: a.range * 1.6, bulletSpeed: a.bulletSpeed * 1.5, maxProjectiles: 1 }),
    () => '射程 ×1.6、弹速 ×1.5；同时最多 1 颗自有子弹，连发/霰弹/破片也受限 · 可回收', ['精准', '可回收'], { priority: 100, maxLevel: 1, resellable: true }),
  mechanism('ascender', '登高者', 'special', 18, (level, a) => ({ ...a, vision: a.vision * (1 + 0.12 * level) }),
    (level) => `可见世界范围 ×${fmt(1 + 0.12 * level)}`, ['视野']),
  buildCard('mine-power', '聚变雷芯', 'mine', 12, [['mineDamage', 'add', 8, '地雷伤害']], ['雷场']),
  buildCard('mine-radius', '扩域雷场', 'mine', 14, [['mineBlastRadius', 'add', 25, '爆炸半径']], ['雷场']),
  buildCard('mine-detection', '敏锐侦测', 'mine', 12, [['mineTriggerRadius', 'add', 20, '侦测半径']], ['雷场']),
  buildCard('mine-field', '广域蛛网', 'mine', 12, [['mineSlowRadius', 'add', 20, '减速半径']], ['雷场']),
  buildCard('mine-cooldown', '快速布雷', 'mine', 18, [['mineCooldownRate', 'multiply', 1.2, '布雷冷却速度']], ['雷场']),
  buildCard('mine-stock', '雷阵编织', 'mine', 20, [['mineLimit', 'add', 1, '地雷上限']], ['雷场']),
  buildCard('mine-slow', '蛛网', 'mine', 16, [['mineSlowMultiplier', 'add', 0.5, '减速倍率']], ['雷场']),
  mechanism('mine-ignore', '无视', 'mine', 18, (_level, a) => ({ ...a, mineIgnoreBullets: 1 }),
    () => '子弹不会触发或击毁地雷；减速倍率高于 1 的部分只保留 45% · 可回收', ['雷场', '可回收'], { priority: 100, maxLevel: 1, resellable: true }),
  mechanism('miner', '掘金者', 'mine', 24, (level, a) => ({ ...a, mineShardChance: 1 - (1 - a.mineShardChance) * 0.85 ** level }),
    (level) => `地雷造成有效伤害时 ${fmt((1 - 0.85 ** level) * 100)}% 概率掉落晶片，拾取 +2 棱晶（受收益倍率影响）`, ['经济', '拾取']),
  mechanism('grenade', '手榴弹', 'mine', 24, (_level, a) => ({ ...a, grenade: 1 }),
    () => '沿释放时移动方向以 160/秒前进 360 距离后引爆；静止时沿枪口 · 可回收', ['手雷', '可回收'], { priority: 100, maxLevel: 1, resellable: true }),
  buildCard('sluggish', '迟钝', 'mine', 12, [['mineHp', 'add', 3, '本体生命'], ['mineFuseSeconds', 'add', 0.6, '引爆延迟/秒']], ['手雷'], false, [{ card: 'grenade', level: 1 }]),
  buildCard('shrapnel', '破片', 'mine', 28, [['mineFragments', 'add', 4, '爆炸碎片弹数']], ['手雷', '弹道']),
  mechanism('gourmet', '美食家', 'recovery', 22, (level, a) => ({ ...a, bloodOrbChance: 1 - (1 - a.bloodOrbChance) * 0.88 ** level }),
    (level) => `子弹有效伤害有 ${fmt((1 - 0.88 ** level) * 100)}% 概率掉落血球，回复至少 4 生命或最大生命 4%`, ['拾取', '续航']),
  buildCard('magnet', '磁吸核心', 'special', 12, [['pickupRadius', 'add', 80, '掉落吸引半径']], ['拾取']),
  buildCard('shield-regen', '自愈电容', 'recovery', 20, [['shieldRegen', 'add', 2, '护盾回复 / 秒']], ['护盾']),
  buildCard('thruster', '矢量推进', 'mobility', 12, [['speed', 'add', 25, '移速']], ['机动']),
  buildCard('core-stability', '核心稳态', 'defense', 18, [['coreRadiusMult', 'multiply', 0.92, '自身核心半径']], ['生存']),
  mechanism('greed', '危险共鸣', 'special', 26, (level, a) => ({ ...a, shardGain: a.shardGain * 1.3 ** level, maxHp: a.maxHp * 0.9 ** level }),
    (level) => `收益 ×${fmt(1.3 ** level)}；最终生命 ×${fmt(0.9 ** level)}`, ['经济', '高风险'], { priority: 1000 }),
  mechanism('rage', '狂暴', 'skill', 32, (_level, a) => ({ ...a, rageLevel: 1 }),
    () => '解锁狂暴：5 秒内伤害 ×1.5、护甲 +30、攻速 ×1.5、吸血 +10%；基础冷却 14 秒', ['主动'], { priority: 50, maxLevel: 1 }),
  mechanism('dash', '冲刺', 'skill', 18, (_level, a) => ({ ...a, dashLevel: 1 }),
    () => '解锁冲刺：移速 ×2.8 持续 0.22 秒；基础冷却 1.4 秒；在主动技能页装备', ['主动'], { priority: 50, maxLevel: 1 }),
  buildCard('field-power', '引力织网', 'skill', 24, [['deflectFieldRadius', 'add', 35, '力场半径'], ['deflectFieldStrength', 'add', 240, '力场强度']], ['偏转'], false, [{ card: 'deflect', level: 1 }]),
  buildCard('skill-cycle', '战术整备', 'skill', 24, [['skillCooldownRate', 'multiply', 1.18, '所有技能冷却速度']], ['主动']),
]
export const ALL_CARDS: readonly Card[] = [...BUILD_CARDS.slice(0, 2), ...CARDS, ...BUILD_CARDS.slice(2)]
export const CARD_REGISTRY = createCardRegistry(ALL_CARDS)
