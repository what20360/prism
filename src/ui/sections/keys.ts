export interface KeyBinding {
  readonly keys: string
  readonly action: string
}

export interface KeyGroup {
  readonly section: string
  readonly items: readonly KeyBinding[]
}

/**
 * Single source of truth for the key-reference page. When rebinding lands
 * (requirements 4.6) this table must read from `settings.keymap` instead.
 */
export const KEY_BINDINGS: readonly KeyGroup[] = [
  {
    section: '移动与战斗',
    items: [
      { keys: 'W A S D / 方向键', action: '移动' },
      { keys: '自动', action: '射击（自动索敌，无需按键）' },
      { keys: 'E', action: '放置地雷（满 3 颗时替换最早的一颗）' },
      { keys: 'J', action: '偏转 / 反射（力场 ×5，并把接触的子弹转为己方）' },
    ],
  },
  {
    section: '界面',
    items: [
      { keys: 'Esc', action: '打开 / 关闭菜单（暂停），左侧切换各个页面' },
      { keys: 'R', action: '死亡或通关后重新开始；局内可用菜单「重新开始」' },
    ],
  },
]

export function renderKeysSection(): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'keys'

  for (const group of KEY_BINDINGS) {
    const section = document.createElement('section')
    section.className = 'menu__section'

    const heading = document.createElement('h3')
    heading.className = 'menu__heading'
    heading.textContent = group.section
    section.append(heading)

    const list = document.createElement('div')
    list.className = 'keys__list'

    for (const item of group.items) {
      const line = document.createElement('div')
      line.className = 'keys__row'

      const keys = document.createElement('kbd')
      keys.textContent = item.keys

      const action = document.createElement('span')
      action.textContent = item.action

      line.append(keys, action)
      list.append(line)
    }

    section.append(list)
    wrapper.append(section)
  }

  return wrapper
}
