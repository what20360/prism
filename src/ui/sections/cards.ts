import { CARD_REGISTRY } from '../../content/cards'
import type { PracticeState, PracticeAction } from '../../app/modes/practice'
import { formatRuleNumber as fmt } from '../../content/format'
import { CARD_ECONOMY } from '../../core/rules'
import type { CardState } from '../../core/progress'
import { formatRequirements } from '../cardInfo'

export interface CardsSectionState {
  readonly shards: number
  readonly cards: readonly CardState[]
  readonly practice?: PracticeState
}

export interface CardsSectionHandlers {
  readonly onQueue?: (cardId: string) => void
  readonly onBuy: (cardId: string) => void
  readonly onSell: (cardId: string) => void
  readonly collapsed?: Set<string>
  readonly onPractice?: (action: PracticeAction) => void
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
  const title = element('span', 'card__title')
  title.append(element('span', 'card__name', card.name))
  if (card.level > 0) title.append(element('span', 'card__level', `Lv${card.level}`))
  head.append(title)

  const meta = element('span', 'card__meta')
  const price = element('span', 'card__price')
  if (card.availability === 'max-level') {
    price.textContent = '已满级'
    price.classList.add('card__price--muted')
  } else {
    price.textContent = `${fmt(card.price)} 棱晶`
    if (card.availability === 'not-enough-shards') price.classList.add('card__price--short')
    else if (card.availability === 'locked') price.classList.add('card__price--muted')
  }
  head.append(price)
  if (card.availability === 'locked') {
    meta.append(element('span', 'card__status', '前置未满足'))
  }

  button.append(head)
  if (meta.childElementCount) button.append(meta)
  button.append(element('span', 'card__priority', `优先级 ${card.priority}`))
  if (card.summary) button.append(element('span', 'card__effect', `${card.availability === 'max-level' ? '当前效果' : '下一级累计'}：${card.summary}`))
  if (requirements) button.append(element('span', 'card__req', `前置：${requirements}`))
  if (card.tags.length) button.append(element('span', 'card__tags', card.tags.join(' / ')))

  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return
    handlers.onBuy(card.id)
  })

  article.append(button)
  if (handlers.onQueue && card.availability !== 'max-level') {
    const queue = document.createElement('button'); queue.type = 'button'; queue.className = 'card__queue'; queue.textContent = `预购${card.name}`
    queue.onclick = () => handlers.onQueue?.(card.id); article.append(queue)
  }
  if (card.refund !== null) {
    const sell = document.createElement('button')
    sell.type = 'button'
    sell.className = 'card__sell'
    sell.disabled = card.saleBlocked !== null
    sell.title = card.saleBlocked ? `被“${card.saleBlocked}”依赖，当前不可出售` : '回收当前等级的效果'
    sell.textContent = card.saleBlocked ? `被${card.saleBlocked}依赖 · 不可出售` : `出售 · 返还 ${card.refund} 棱晶`
    sell.setAttribute('aria-label', `出售${card.name}，返还 ${card.refund} 棱晶`)
    sell.addEventListener('click', () => handlers.onSell(card.id))
    article.append(sell)
  }
  if (state.practice && handlers.onPractice) {
    const edit = element('div', 'card__test-controls')
    const level = document.createElement('input'); level.type = 'number'; level.min = '0'; level.step = '1'; level.value = String(card.level); level.required = true; level.setAttribute('aria-label', `${card.name}等级`)
    const maximum = CARD_REGISTRY.get(card.id)?.maxLevel
    if (maximum !== undefined) level.max = String(maximum)
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = '设定等级'; apply.setAttribute('aria-label', `设定${card.name}等级`)
    apply.onclick = () => { if (level.reportValidity()) handlers.onPractice?.({ type: 'card-level', id: card.id, level: level.valueAsNumber }) }
    edit.append(level, apply); article.append(edit)
  }
  return article
}

/** Upgrade browser: one section per category, every card carries its own numbers. */
export function renderCardsSection(
  state: CardsSectionState,
  handlers: CardsSectionHandlers,
): HTMLElement {
  const wrapper = element('div', 'cards')
  wrapper.append(element('p', 'menu__hint', state.practice?.config.freeCards ? '测试场 · 自由购卡' : `可用棱晶 ${Math.floor(state.shards)}`))
  wrapper.append(element('p', 'cards__intro', `所有卡片都可逐级出售，返还实付价格的 ${fmt(CARD_ECONOMY.refundRatio * 100)}%；前置仅限制购买，出售不会连带撤销其他卡片。成长卡不限等级，纯功能开关仅解锁一次。优先级数值越小越先生效，同值按固定顺序处理。`))

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
    const section = document.createElement('details')
    section.className = 'menu__section cards__category'
    section.open = !handlers.collapsed?.has(category)
    const summary = element('summary', 'menu__heading', `${CATEGORY_LABELS[category] ?? category} · ${grouped.get(category)?.length ?? 0}`)
    section.append(summary)
    section.addEventListener('toggle', () => { if (section.open) handlers.collapsed?.delete(category); else handlers.collapsed?.add(category) })

    const grid = element('div', 'cards__grid')
    for (const card of grouped.get(category) ?? []) {
      grid.append(cardButton(state, card, handlers))
    }
    section.append(grid)
    wrapper.append(section)
  }

  return wrapper
}
