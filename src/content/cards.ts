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

export const BUILD_CARDS: readonly Card[] = [
  { id: 'auto-aim', name: '自动索敌', category: 'special', priority: 0, priceFn: priceFor(12),
    maxLevel: 1, resellable: true, tags: ['操控'],
    effectFn: (_level, attrs) => ({ ...attrs, autoAim: 1 }),
    summary: () => '解锁并启用自动瞄准；设置中可切回手动 · 可回收 60%' },
  { id: 'auto-fire', name: '自动扳机', category: 'special', priority: 0, priceFn: priceFor(12),
    maxLevel: 1, resellable: true, tags: ['操控'],
    effectFn: (_level, attrs) => ({ ...attrs, autoFire: 1 }),
    summary: () => '解锁并启用自动射击；设置中可切回手动 · 可回收 60%' },
  buildCard('scatter', '分形弹匣', 'gun', 40,
    [['multishot', 'add', 1, '弹数'], ['damage', 'multiply', 0.88, '伤害']], ['弹幕']),
  buildCard('ricochet', '棱镜跳弹', 'gun', 26, [['ricochet', 'add', 1, '反弹次数']], ['跳弹']),
  buildCard('explosive', '星爆弹头', 'gun', 32,
    [['blastRadius', 'add', 45, '爆炸半径'], ['damage', 'multiply', 0.94, '伤害']], ['爆破']),
  buildCard('heavy-stance', '重弹姿态', 'gun', 24,
    [['damage', 'multiply', 1.3, '伤害'], ['bulletSpeed', 'multiply', 0.85, '弹速']], ['重炮', '可回收'], true),
  buildCard('rapid-stance', '极速姿态', 'gun', 24,
    [['fireRate', 'multiply', 1.3, '射速'], ['damage', 'multiply', 0.9, '伤害']], ['弹幕', '可回收'], true),
  buildCard('precision-stance', '狙击姿态', 'gun', 28,
    [['damage', 'multiply', 1.25, '伤害'], ['range', 'add', 100, '射程'], ['fireRate', 'multiply', 0.9, '射速']], ['精准', '可回收'], true),
  buildCard('mine-power', '聚变雷芯', 'mine', 12, [['mineDamage', 'add', 8, '地雷伤害']], ['雷场']),
  buildCard('mine-radius', '扩域雷场', 'mine', 14, [['mineBlastRadius', 'add', 25, '爆炸半径']], ['雷场']),
  buildCard('mine-cooldown', '快速布雷', 'mine', 18, [['mineCooldown', 'multiply', 0.88, '地雷冷却']], ['雷场']),
  buildCard('mine-stock', '雷阵编织', 'mine', 20, [['mineLimit', 'add', 1, '地雷上限']], ['雷场']),
  buildCard('mine-slow', '滞缓晶核', 'mine', 16, [['mineSlow', 'add', 0.06, '地雷减速比例']], ['雷场']),
  buildCard('shield-regen', '自愈电容', 'recovery', 20, [['shieldRegen', 'add', 2, '护盾回复 / 秒']], ['护盾']),
  buildCard('thruster', '矢量推进', 'mobility', 12, [['speed', 'add', 25, '移速']], ['机动']),
  buildCard('core-stability', '核心稳态', 'defense', 18, [['coreRadiusMult', 'multiply', 0.92, '自身核心半径']], ['生存']),
  buildCard('fortress', '重装壁垒', 'defense', 24,
    [['armor', 'add', 25, '护甲'], ['speed', 'multiply', 0.94, '移速']], ['护盾', '重装']),
  buildCard('glass-cannon', '玻璃星核', 'gun', 28,
    [['damage', 'multiply', 1.45, '伤害'], ['maxHp', 'multiply', 0.85, '生命上限']], ['重炮', '高风险']),
  buildCard('greed', '危险共鸣', 'special', 26,
    [['shardGain', 'multiply', 1.3, '收益'], ['maxHp', 'multiply', 0.9, '生命上限']], ['经济', '高风险']),
  buildCard('blood', '血色回路', 'recovery', 24,
    [['lifesteal', 'add', 0.05, '吸血比例'], ['armor', 'add', -8, '护甲']], ['汲取']),
  buildCard('field-power', '引力织网', 'skill', 24,
    [['deflectFieldRadius', 'add', 35, '力场半径'], ['deflectFieldStrength', 'add', 240, '力场强度']], ['反射'], false, [{ card: 'deflect', level: 1 }]),
  buildCard('skill-cycle', '回响回路', 'skill', 26,
    [['deflectCooldownSeconds', 'multiply', 0.88, '技能冷却'], ['deflectWindowSeconds', 'add', 0.04, '主动窗口']], ['反射'], false, [{ card: 'deflect', level: 1 }]),
]

export const ALL_CARDS: readonly Card[] = [...BUILD_CARDS.slice(0, 2), ...CARDS, ...BUILD_CARDS.slice(2)]
export const CARD_REGISTRY = createCardRegistry(ALL_CARDS)
