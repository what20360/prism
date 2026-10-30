const RULES: readonly { term: string; text: string }[] = [
  { term: '棱晶', text: '造成伤害与承受伤害都会获得，用于购买卡片' },
  { term: '收益', text: '按实际打出的伤害结算，溢出的伤害按 50% 计入' },
  { term: '内层', text: '命中核心伤害 ×1.5；需要穿透层数 ≥ 2' },
  { term: '护甲', text: '减伤 = 护甲 / (100 + 护甲)，永远到不了 100%' },
  { term: '地雷', text: '踩到或被子弹触发后 0.08 秒爆炸，爆炸同时清除范围内敌方子弹' },
  { term: '力场', text: '未解锁时没有力场；解锁后敌方子弹越靠近你，被推得越偏' },
  { term: '出口', text: '清空房间后顶部出现 EXIT，走进去进入下一房' },
]

const FLOW: readonly string[] = [
  '5 层 × 5 房，每层最后一间是守卫房，通关后进入下一层。',
  '最终房间是 Boss，击败即通关。',
  '死亡即本局结束；通关或死亡后按 R 重新开始。',
  'Esc 菜单也可随时重新开始；瞄准与射击设置在刷新后保留。',
  '房间要走进才会开始刷怪：进门时先看清掩体，再推进。',
]

function list(title: string, entries: readonly { key: string; text: string }[]): HTMLElement {
  const section = document.createElement('section')
  section.className = 'menu__section'

  const heading = document.createElement('h3')
  heading.className = 'menu__heading'
  heading.textContent = title
  section.append(heading)

  const wrapper = document.createElement('div')
  wrapper.className = 'help__list'

  for (const entry of entries) {
    const line = document.createElement('div')
    line.className = 'help__row'

    const term = document.createElement('span')
    term.className = 'help__term'
    term.textContent = entry.key

    const text = document.createElement('span')
    text.textContent = entry.text

    line.append(term, text)
    wrapper.append(line)
  }

  section.append(wrapper)
  return section
}

export function renderHelpSection(): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'help'

  wrapper.append(
    list('规则速查', RULES.map((rule) => ({ key: rule.term, text: rule.text }))),
    list(
      '流程',
      FLOW.map((text, index) => ({ key: `第 ${index + 1} 点`, text })),
    ),
  )

  return wrapper
}
