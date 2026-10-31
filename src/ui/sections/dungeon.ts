import { DUNGEON_START_SHARDS, difficultyName, type DungeonDifficulty } from '../../content/difficulties'
export function renderDungeonSection(state: { difficulty: DungeonDifficulty; seed: number; wave: number; waves: number }): HTMLElement {
  const root = document.createElement('section'), heading = document.createElement('h2'); heading.textContent = '闯关状态'; root.append(heading)
  const metrics = document.createElement('dl'); metrics.className = 'practice__metrics'
  for (const [label, value] of [['难度', difficultyName(state.difficulty)], ['世界种子', String(state.seed)], ['当前波次', `${state.wave} / ${state.waves}`], ['开局棱晶', String(DUNGEON_START_SHARDS)]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label!; dd.textContent = value!; metrics.append(dt, dd)
  }
  const rules = document.createElement('p'); rules.className = 'cards__intro'; rules.textContent = state.difficulty === 1 ? '标准难度使用基础敌人强度、数量与单波机制。布局和出生位置由世界种子决定。' : '怪物属性、每波数量与波数随难度和房间深度成长。清理全部波次才能推进；绝境难度适合熟悉构筑与操作后挑战。'
  const note = document.createElement('p'); note.className = 'settings__hint'; note.textContent = '下一波出生前有 1.5 秒位置预警；房间资源仅入场时生成一次。存档保留难度、波次和随机状态。重新开始保留种子及难度，并重新发放开局预算。'
  root.append(metrics, rules, note); return root
}
