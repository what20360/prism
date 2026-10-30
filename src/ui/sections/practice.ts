import { DEFAULT_PRACTICE, type PracticeAction, type PracticeConfig, type PracticeState } from '../../app/modes/practice'
export function renderPracticeSection(state: PracticeState, onAction: (action: PracticeAction) => void, onRestart: () => void): HTMLElement {
  const root = document.createElement('section'); root.className = 'practice-page'
  const title = document.createElement('h2'); title.textContent = '测试控制'
  const intro = document.createElement('p'); intro.className = 'cards__intro'; intro.textContent = '靶机击败后会恢复，适合持续比较伤害；敌人演练可用于验证走位、雷场和生存。场景重置保留构筑，重置构筑会开始全新的测试。'
  root.append(title, intro)
  const metrics = document.createElement('dl'); metrics.className = 'practice__metrics'
  for (const [label, value] of [['总伤害', state.damage.toFixed(1)], ['近 3 秒 DPS', state.recentDps.toFixed(1)], ['平均 DPS', state.averageDps.toFixed(1)], ['击杀', String(state.kills)]]) {
    const dt = document.createElement('dt'); dt.textContent = label!; const dd = document.createElement('dd'); dd.textContent = value!; metrics.append(dt, dd)
  }
  root.append(metrics)
  const form = document.createElement('form'); form.className = 'practice__form'
  const field = (text: string, control: HTMLElement) => { const label = document.createElement('label'); label.className = 'practice__field'; const name = document.createElement('span'); name.textContent = text; label.append(name, control); form.append(label) }
  const select = (options: readonly (readonly [string, string])[], value: string): HTMLSelectElement => {
    const input = document.createElement('select'); for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option) } input.value = value; return input
  }
  const number = (value: number, min: number, max: number): HTMLInputElement => { const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '1'; input.value = String(value); input.required = true; return input }
  const scenario = select([['targets', '固定靶机'], ['combat', '敌人演练']], state.config.scenario); field('场景类型', scenario)
  const layout = select([['open', '开阔场地'], ['cover', '掩体场地']], state.config.layout); field('场地布局', layout)
  const count = number(state.config.count, 1, 12); field('目标数量', count)
  const hp = number(state.config.hp, 1, 100000); field('目标生命', hp)
  const armor = number(state.config.armor, 0, 1000); field('目标护甲', armor)
  const check = (text: string, checked: boolean) => { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; field(text, input); return input }
  const invincible = check('玩家无敌', state.config.invincible), freeCards = check('自由购卡', state.config.freeCards)
  const apply = document.createElement('button'); apply.className = 'practice__primary'; apply.type = 'submit'; apply.textContent = '应用场景（保留构筑）'; form.append(apply)
  form.onsubmit = (event) => { event.preventDefault(); if (form.reportValidity()) onAction({ type: 'configure', config: { scenario: scenario.value as PracticeConfig['scenario'], layout: layout.value as PracticeConfig['layout'], count: count.valueAsNumber, hp: hp.valueAsNumber, armor: armor.valueAsNumber, invincible: invincible.checked, freeCards: freeCards.checked } }) }
  root.append(form)
  const actions = document.createElement('div'); actions.className = 'practice__actions'
  for (const [type, text] of [['scene-reset', '重置场景（保留构筑）'], ['meters-reset', '重置伤害统计'], ['restore', '恢复生命与技能冷却'], ['clear', '清除弹幕与地雷']] as const) {
    const button = document.createElement('button'); button.className = 'settings__option'; button.textContent = text; button.onclick = () => onAction({ type }); actions.append(button)
  }
  const restart = document.createElement('button'); restart.className = 'settings__option'; restart.textContent = '重置构筑与场景'; restart.onclick = onRestart; actions.append(restart)
  const defaults = document.createElement('button'); defaults.className = 'settings__option'; defaults.textContent = '恢复默认测试配置'; defaults.onclick = () => onAction({ type: 'configure', config: DEFAULT_PRACTICE }); actions.append(defaults)
  const note = document.createElement('p'); note.className = 'settings__hint'; note.textContent = '在升级面板可以直接设置卡片等级（0–20，遵守卡片等级上限，可绕过前置）。近 3 秒 DPS 按有效伤害计算；本测试场不会带入正常闯关。'
  root.append(actions, note); return root
}
