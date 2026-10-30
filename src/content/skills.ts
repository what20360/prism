import type { SkillId } from '../core/world'
export const SKILL_NAMES: Record<SkillId, string> = { deflect: '偏转', rage: '狂暴', dash: '冲刺' }
export const SKILL_DESCRIPTIONS: Record<SkillId, string> = {
  deflect: '短暂强化力场并夺回接触的子弹；被动力场始终保留。',
  rage: '5 秒内伤害 ×1.5、护甲 +30、攻速 ×1.5、吸血 +10%；基础冷却 14 秒。',
  dash: '沿移动方向冲刺 0.22 秒，移速 ×2.8；基础冷却 1.4 秒，不提供穿墙或无敌。',
}
