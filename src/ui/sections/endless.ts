import type { EndlessState } from '../../app/modes/endless'
import { formatRuleNumber as fmt } from '../../content/format'
export function renderEndlessSection(state: EndlessState): HTMLElement {
  const root = document.createElement('section'); root.className = 'endless-page'
  const heading = document.createElement('h2'); heading.textContent = '无尽状态'; root.append(heading)
  const stats = document.createElement('dl'); stats.className = 'practice__metrics'
  for (const [label, value] of [['世界种子', String(state.seed)], ['当前层数', String(state.floor)], ['存活 / 待入场', `${state.alive} / ${state.pending}`], state.open ? ['下次补刷奖励', `${fmt(state.nextReward * 100)}%`] : ['入场敌人数', String(state.initialCount)]]) {
    const dt = document.createElement('dt'); dt.textContent = label!; const dd = document.createElement('dd'); dd.textContent = value!; stats.append(dt, dd)
  }
  const type = document.createElement('h3'); type.textContent = state.open ? '开放层 · 传送门已开启' : '清场层 · 击败所有敌人后推进'
  const rules = document.createElement('p'); rules.className = 'cards__intro'; rules.textContent = state.open
    ? '可直接进入下一层。怪物死亡后继续补刷，随机强度没有层数上界；越晚补刷的怪物，棱晶奖励倍率越低。'
    : `本层只在入场时生成 ${state.initialCount} 个敌人，各项强度经过层数上界检查，不会持续补刷。`
  const help = document.createElement('p'); help.className = 'settings__hint'; help.textContent = '每五层进入一次开放层。怪物主要数值的均值随层数指数增长；房间血球与晶片只在进入时生成。重新开始会使用同一种子，从第 1 层重新出发。'
  root.append(stats, type, rules, help); return root
}
