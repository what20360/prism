export interface HelpEntry {
  readonly keys: string
  readonly action: string
}

export interface HelpPanel {
  toggle(): void
  show(): void
  hide(): void
  readonly visible: boolean
}

/** Static key reference; kept next to the input layer so it stays in sync. */
const ENTRIES: readonly { section: string; items: readonly HelpEntry[] }[] = [
  {
    section: '移动与战斗',
    items: [
      { keys: 'W A S D / 方向键', action: '移动' },
      { keys: '自动', action: '射击（自动索敌，无需按键）' },
      { keys: 'E', action: '放置地雷（冷却 2 秒，同时最多 3 个）' },
      { keys: 'J', action: '偏转 / 反射（力场 ×5，并夺回子弹）' },
    ],
  },
  {
    section: '界面',
    items: [
      { keys: 'Tab', action: '打开 / 关闭升级面板（暂停）' },
      { keys: 'H', action: '打开 / 关闭按键说明' },
      { keys: 'R', action: '死亡或通关后重开' },
    ],
  },
  {
    section: '规则速查',
    items: [
      { keys: '棱晶', action: '造成伤害与承受伤害都会获得，用于购买卡片' },
      { keys: '内层', action: '命中核心伤害 ×1.5；需要穿透层数 ≥ 2' },
      { keys: '护甲', action: '减伤 = 护甲 / (100 + 护甲)，永远到不了 100%' },
      { keys: '出口', action: '清空房间后顶部出现 EXIT，走进去进入下一房' },
    ],
  },
]

export function createHelpPanel(root: HTMLElement): HelpPanel {
  const overlay = document.createElement('div')
  overlay.className = 'panel panel--help'
  overlay.hidden = true

  const header = document.createElement('div')
  header.className = 'panel__header'

  const title = document.createElement('h2')
  title.textContent = '按键与规则'

  const close = document.createElement('button')
  close.className = 'panel__close'
  close.textContent = '关闭 (H)'
  close.addEventListener('click', () => hide())
  header.append(title, close)

  const grid = document.createElement('div')
  grid.className = 'help__grid'

  for (const group of ENTRIES) {
    const section = document.createElement('section')
    section.className = 'panel__section'

    const heading = document.createElement('h3')
    heading.textContent = group.section
    section.append(heading)

    const list = document.createElement('div')
    list.className = 'help__list'

    for (const item of group.items) {
      const row = document.createElement('div')
      row.className = 'help__row'

      const keys = document.createElement('kbd')
      keys.textContent = item.keys

      const action = document.createElement('span')
      action.textContent = item.action

      row.append(keys, action)
      list.append(row)
    }

    section.append(list)
    grid.append(section)
  }

  overlay.append(header, grid)
  root.append(overlay)

  const show = (): void => {
    overlay.hidden = false
  }

  const hide = (): void => {
    overlay.hidden = true
  }

  const toggle = (): void => {
    if (overlay.hidden) show()
    else hide()
  }

  return {
    toggle,
    show,
    hide,
    get visible() {
      return !overlay.hidden
    },
  }
}
