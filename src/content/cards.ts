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
      deflectFieldRadius: level === 1 ? 220 : attrs.deflectFieldRadius + 40,
      deflectFieldStrength: level === 1 ? 600 : attrs.deflectFieldStrength + 150,
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

export const CARD_REGISTRY = createCardRegistry(CARDS)
