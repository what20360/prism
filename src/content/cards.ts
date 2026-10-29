import { createCardRegistry } from '../core/cards'
import type { AttrKey, AttrSet } from '../core/attrs'
import type { Card, Requirement } from '../core/cards'

const GROWTH = 1.6

/** Price depends only on the purchase count (docs/requirements.md 5.3.1). */
function priceFor(base: number): (level: number) => number {
  return (level) => Math.round(base * Math.pow(GROWTH, level - 1))
}

function addAttr(key: AttrKey, perLevel: number): (level: number, attrs: AttrSet) => AttrSet {
  return (level, attrs) => ({ ...attrs, [key]: (attrs[key] as number) + perLevel * level })
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
    effectFn: addAttr('damage', 2),
  },
  {
    id: 'gun-firerate',
    name: '循环加速',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(12),
    effectFn: addAttr('fireRate', 0.2),
  },
  {
    id: 'gun-bulletspeed',
    name: '高速装药',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(8),
    effectFn: addAttr('bulletSpeed', 90),
  },
  {
    id: 'gun-range',
    name: '加长枪管',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(6),
    effectFn: addAttr('range', 70),
  },
  {
    id: 'gun-pierce',
    name: '穿透弹',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(20),
    effectFn: addAttr('pierce', 1),
  },
  {
    id: 'gun-size',
    name: '扩口径',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(8),
    effectFn: addAttr('bulletSize', 1),
  },
  {
    id: 'gun-penetration',
    name: '破甲弹',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(14),
    effectFn: addAttr('penetration', 20),
  },
  {
    id: 'gun-inner',
    name: '核心校准',
    category: 'gun',
    priority: 10,
    priceFn: priceFor(18),
    effectFn: addAttr('innerDamageMult', 0.1),
  },
  {
    id: 'armor',
    name: '复合装甲',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(14),
    effectFn: addAttr('armor', 10),
  },
  {
    id: 'maxhp',
    name: '强化骨架',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(8),
    effectFn: addAttr('maxHp', 10),
  },
  {
    id: 'shield',
    name: '护盾模块',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(12),
    effectFn: addAttr('shield', 10),
  },
  {
    id: 'shield-cap',
    name: '护盾上限',
    category: 'defense',
    priority: 20,
    priceFn: priceFor(16),
    effectFn: addAttr('shieldCapMult', 0.25),
  },
  {
    id: 'shard-gain',
    name: '棱晶共鸣',
    category: 'special',
    priority: 5,
    priceFn: priceFor(20),
    effectFn: addAttr('shardGain', 0.1),
  },
  {
    id: 'lifesteal',
    name: '汲取',
    category: 'recovery',
    priority: 30,
    priceFn: priceFor(18),
    effectFn: addAttr('lifesteal', 0.02),
    requires: [atLeast('shardGain', 1.1)],
  },
  {
    id: 'shield-steal',
    name: '吸盾',
    category: 'recovery',
    priority: 30,
    priceFn: priceFor(18),
    effectFn: addAttr('shieldSteal', 0.02),
    requires: [atLeast('shieldCapMult', 1.25)],
  },
  {
    id: 'revive',
    name: '备用核心',
    category: 'special',
    priority: 40,
    priceFn: priceFor(60),
    maxLevel: 2,
    effectFn: addAttr('revives', 1),
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
    requires: [{ card: 'deflect', level: 1 }, atLeast('armor', 50)],
  },
]

export const CARD_REGISTRY = createCardRegistry(CARDS)
