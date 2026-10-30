import type { SkillId } from '../core/world'
import { rageProfile, dashProfile } from '../core/rules'
import { formatRuleNumber as fmt } from './format'
export const SKILL_NAMES: Record<SkillId, string> = { deflect: '偏转', rage: '狂暴', dash: '冲刺' }
export function describeRage(level: number): string {
  const p = rageProfile(level)
  return `${fmt(p.duration)} 秒内伤害与地雷伤害 ×${fmt(p.damageMultiplier)}、护甲 +${fmt(p.armor)}、攻速 ×${fmt(p.fireRateMultiplier)}、吸血 +${fmt(p.lifesteal * 100)}%；基础冷却 ${fmt(p.cooldown)} 秒`
}
export function describeDash(level: number): string {
  const p = dashProfile(level)
  return `沿移动方向冲刺 ${fmt(p.duration)} 秒，移速 ×${fmt(p.speedMultiplier)}；基础冷却 ${fmt(p.cooldown)} 秒，不提供穿墙或无敌`
}
export function describeSkill(id: SkillId, level = 1): string {
  return id === 'rage' ? describeRage(level) : id === 'dash' ? describeDash(level) : '短暂强化力场并夺回接触的子弹；被动力场始终保留。'
}
export const SKILL_DESCRIPTIONS: Record<SkillId, string> = { deflect: describeSkill('deflect'), rage: describeRage(1), dash: describeDash(1) }
