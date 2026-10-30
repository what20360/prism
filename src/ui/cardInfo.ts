import type { AttrKey } from '../core/attrs'
import type { Requirement } from '../core/cards'

/** UI-side labels; core stays free of presentation text. */
export const ATTR_LABELS: Record<AttrKey, string> = {
  maxHp: '最大生命',
  speed: '移动速度',
  radius: '碰撞半径',
  coreRadiusMult: '核心半径系数',

  armor: '护甲',
  shield: '护盾',
  shieldCapMult: '护盾上限系数',
  shieldRegen: '护盾回复',

  damage: '伤害',
  fireRate: '射速',
  bulletSpeed: '弹速',
  range: '射程',
  pierce: '穿透层数',
  bulletSize: '子弹大小',
  blastRadius: '伤害范围',
  penetration: '护甲穿透',
  multishot: '多重射击',
  ricochet: '反弹次数',
  autoAim: '自动索敌',
  autoFire: '自动扳机',
  mineDamage: '地雷伤害',
  mineBlastRadius: '地雷半径',
  mineCooldown: '地雷冷却',
  mineLimit: '地雷上限',
  mineSlow: '地雷减速',

  lifesteal: '吸血',
  shieldSteal: '吸盾',

  innerDamageMult: '内层伤害倍率',
  revives: '复活次数',
  chainCap: '连杀上限',

  shardGain: '棱晶收益',

  deflectLevel: '偏转等级',
  deflectWindowSeconds: '主动窗口',
  deflectCooldownSeconds: '技能冷却',
  reflectDamageMult: '反射伤害倍率',
  deflectFieldRadius: '力场半径',
  deflectFieldStrength: '力场强度',
}

const PERCENT_ATTRS: ReadonlySet<AttrKey> = new Set<AttrKey>([
  'lifesteal',
  'shieldSteal',
  'shardGain',
  'coreRadiusMult',
  'shieldCapMult',
])

export function formatNumber(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function formatAttrValue(key: AttrKey, value: number): string {
  return PERCENT_ATTRS.has(key) ? `${formatNumber(value * 100)}%` : formatNumber(value)
}

export function formatRequirement(
  requirement: Requirement,
  nameOf: (id: string) => string,
): string {
  if (requirement.attr !== undefined) {
    const label = ATTR_LABELS[requirement.attr] ?? requirement.attr
    const min = requirement.min ?? 0
    return `${label} ≥ ${formatAttrValue(requirement.attr, min)}`
  }
  if (requirement.card !== undefined) {
    return `${nameOf(requirement.card)} Lv${requirement.level ?? 1}`
  }
  return '未知前置'
}

export function formatRequirements(
  requirements: readonly Requirement[],
  nameOf: (id: string) => string,
): string | null {
  if (requirements.length === 0) return null
  return requirements.map((requirement) => formatRequirement(requirement, nameOf)).join(' 且 ')
}
