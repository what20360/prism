import type { CardState } from '../../core/progress'
import { formatRequirements } from '../cardInfo'

export interface CardsSectionState {
  readonly shards: number
  readonly cards: readonly CardState[]
}

export interface CardsSectionHandlers {
  readonly onBuy: (cardId: string) => void
  readonly onSell: (cardId: string) => void
}

const CATEGORY_ORDER: readonly string[] = [
  'gun',
  'mine',
  'defense',
  'recovery',
  'mobility',
  'skill',
  'special',
]

const CATEGORY_LABELS: Record<string, string> = {
  gun: '枪械与弹道',
  mine: '地雷',
  defense: '防御',
  recovery: '恢复',
  mobility: '机动',
  skill: '技能',
  special: '特殊',
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function cardButton(
  state: CardsSectionState,
  card: CardState,
  handlers: CardsSectionHandlers,
): HTMLElement {
  const nameOf = (id: string): string =>
    state.cards.find((candidate) => candidate.id === id)?.name ?? id
  const requirements = formatRequirements(card.requires, nameOf)

  const article = element('article', `card-shell${card.level > 0 ? ' card-shell--owned' : ''}`)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `card card--${card.availability}`
  button.setAttribute('aria-disabled', String(card.availability !== 'ok'))

  const head = element('span', 'card__head')
  head.append(element('span', 'card__name', card.name))
  if (card.level > 0) head.append(element('span', 'card__level', `Lv${card.level}`))

  const meta = element('span', 'card__meta')
  const price = element('span', 'card__price')
  if (card.availability === 'max-level') {
    price.textContent = '已满级'
    price.classList.add('card__price--muted')
  } else {
    price.textContent = `${card.price} 棱晶`
    if (card.availability === 'not-enough-shards') price.classList.add('card__price--short')
    else if (card.availability === 'locked') price.classList.add('card__price--muted')
  }
  meta.append(price)
  if (card.availability === 'locked') {
    meta.append(element('span', 'card__status', '前置未满足'))
  }

  button.append(head, meta)
  if (card.summary) button.append(element('span', 'card__effect', card.summary))
  if (requirements) button.append(element('span', 'card__req', `前置：${requirements}`))
  if (card.tags.length) button.append(element('span', 'card__tags', card.tags.join(' / ')))

  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return
    handlers.onBuy(card.id)
  })

  article.append(button)
  if (card.refund !== null) {
    const sell = document.createElement('button')
    sell.type = 'button'
    sell.className = 'card__sell'
    sell.textContent = `出售 · 返还 ${card.refund} 棱晶`
    sell.setAttribute('aria-label', `出售${card.name}，返还 ${card.refund} 棱晶`)
    sell.addEventListener('click', () => handlers.onSell(card.id))
    article.append(sell)
  }
  return article
}

/** Upgrade browser: one section per category, every card carries its own numbers. */
export function renderCardsSection(
  state: CardsSectionState,
  handlers: CardsSectionHandlers,
): HTMLElement {
  const wrapper = element('div', 'cards')
  wrapper.append(element('p', 'menu__hint', `可用棱晶 ${Math.floor(state.shards)}`))
  wrapper.append(element('p', 'cards__intro', '选择自己的战斗方式。操控卡与姿态卡可回收实付价格的 60%；普通成长卡永久生效至本局结束。'))

  const grouped = new Map<string, CardState[]>()
  for (const card of state.cards) {
    const list = grouped.get(card.category)
    if (list) list.push(card)
    else grouped.set(card.category, [card])
  }

  const categories = [...grouped.keys()].sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a)
    const indexB = CATEGORY_ORDER.indexOf(b)
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB)
  })

  for (const category of categories) {
    const section = element('section', 'menu__section')
    section.append(element('h3', 'menu__heading', CATEGORY_LABELS[category] ?? category))

    const grid = element('div', 'cards__grid')
    for (const card of grouped.get(category) ?? []) {
      grid.append(cardButton(state, card, handlers))
    }
    section.append(grid)
    wrapper.append(section)
  }

  return wrapper
}
