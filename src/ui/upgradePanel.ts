import type { CardState } from '../core/progress'

export interface PanelState {
  readonly shards: number
  readonly cards: readonly CardState[]
}

export interface UpgradePanelHandlers {
  readonly onBuy: (cardId: string) => void
  readonly onClose: () => void
}

export interface UpgradePanel {
  show(state: PanelState): void
  hide(): void
  render(state: PanelState): void
  readonly visible: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  gun: '枪械与弹道',
  mine: '地雷',
  defense: '防御',
  recovery: '恢复',
  mobility: '机动',
  skill: '技能',
  special: '特殊',
}

const REASON_LABELS: Record<string, string> = {
  locked: '前置未满足',
  'max-level': '已满级',
  'not-enough-shards': '棱晶不足',
}

export function createUpgradePanel(root: HTMLElement, handlers: UpgradePanelHandlers): UpgradePanel {
  const overlay = document.createElement('div')
  overlay.className = 'panel'
  overlay.hidden = true

  const header = document.createElement('div')
  header.className = 'panel__header'

  const title = document.createElement('h2')
  title.textContent = '升级'

  const shards = document.createElement('span')
  shards.className = 'panel__shards'

  const close = document.createElement('button')
  close.className = 'panel__close'
  close.textContent = '关闭 (Tab)'
  close.addEventListener('click', () => handlers.onClose())

  header.append(title, shards, close)

  const grid = document.createElement('div')
  grid.className = 'panel__grid'

  overlay.append(header, grid)
  root.append(overlay)

  let current: PanelState | undefined

  const render = (state: PanelState): void => {
    current = state
    shards.textContent = `棱晶 ${Math.floor(state.shards)}`
    grid.replaceChildren()

    const grouped = new Map<string, CardState[]>()
    for (const card of state.cards) {
      const list = grouped.get(card.category)
      if (list) list.push(card)
      else grouped.set(card.category, [card])
    }

    for (const [category, cards] of grouped) {
      const section = document.createElement('section')
      section.className = 'panel__section'

      const heading = document.createElement('h3')
      heading.textContent = CATEGORY_LABELS[category] ?? category
      section.append(heading)

      const list = document.createElement('div')
      list.className = 'panel__cards'

      for (const card of cards) {
        const button = document.createElement('button')
        button.className = 'card'
        button.disabled = card.availability !== 'ok'
        if (card.availability !== 'ok') button.classList.add('card--disabled')

        const name = document.createElement('span')
        name.className = 'card__name'
        name.textContent = card.name

        const meta = document.createElement('span')
        meta.className = 'card__meta'
        const levelText = card.level > 0 ? `Lv${card.level} · ` : ''
        const reason = REASON_LABELS[card.availability]
        meta.textContent = reason ? `${levelText}${reason}` : `${levelText}${card.price} 棱晶`

        button.append(name, meta)
        button.addEventListener('click', () => handlers.onBuy(card.id))
        list.append(button)
      }

      section.append(list)
      grid.append(section)
    }
  }

  const show = (state: PanelState): void => {
    render(state)
    overlay.hidden = false
  }

  const hide = (): void => {
    overlay.hidden = true
  }

  return {
    show,
    hide,
    render: (state) => {
      if (current) render(state)
    },
    get visible() {
      return !overlay.hidden
    },
  }
}
