import type { CardState } from '../core/progress'
import type { QuickMode } from '../app/upgradePlans'
import type { PurchaseNotice } from '../app/purchaseQueue'
export function createQuickBuy(root: HTMLElement, options: {
  active: () => boolean; mode: () => QuickMode; favorites: () => readonly string[]; notice: () => PurchaseNotice | null
  cards: () => readonly CardState[]; buy: (id: string) => void
}) {
  const layer = document.createElement('aside'); layer.className = 'edge-buy'; layer.setAttribute('aria-label', '快捷购买'); layer.hidden = true
  const toggle = document.createElement('button'); toggle.className = 'edge-buy__toggle'; toggle.textContent = '★ 收藏卡片'; toggle.setAttribute('aria-expanded', 'false')
  const tray = document.createElement('div'); tray.className = 'edge-buy__favorites'; tray.hidden = true
  toggle.onclick = () => { tray.hidden = !tray.hidden; toggle.setAttribute('aria-expanded', String(!tray.hidden)) }
  const offer = document.createElement('button'); offer.type = 'button'; offer.className = 'edge-buy__offer'; offer.hidden = true
  const tag = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('span'), timer = document.createElement('span'); timer.className = 'edge-buy__countdown'
  tag.textContent = '流派升级可购买'; offer.append(tag, title, detail, timer); layer.append(toggle, tray, offer); root.append(layer)
  let favoriteSignature = '', offered: string | null = null
  offer.onclick = () => {
    const notice = options.notice(), card = options.cards().find((c) => c.id === offered)
    if (notice && notice.id === offered && card?.level === notice.level - 1 && card.availability === 'ok') options.buy(card.id)
    render()
  }
  const render = () => {
    const active = options.active(), mode = options.mode(); layer.hidden = !active; if (!active) return
    const cards = options.cards(), favorites = cards.filter((c) => options.favorites().includes(c.id))
    toggle.hidden = mode !== 'favorites'; tray.hidden = mode !== 'favorites' || toggle.getAttribute('aria-expanded') !== 'true'
    if (mode === 'favorites') {
      const signature = JSON.stringify(favorites)
      if (signature !== favoriteSignature) {
        favoriteSignature = signature; tray.replaceChildren()
        if (!favorites.length) { const empty = document.createElement('p'); empty.textContent = '在升级页收藏常用卡片'; tray.append(empty) }
        for (const card of favorites) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = `${card.name} Lv${card.level + 1} · ${card.price}◆`
          b.setAttribute('aria-label', `购买收藏卡片${card.name}`); b.disabled = card.availability !== 'ok'; b.title = card.summary ?? ''
          b.onclick = () => { options.buy(card.id); favoriteSignature = ''; render() }; tray.append(b)
        }
      }
    }
    const notice = mode === 'planned' ? options.notice() : null, card = cards.find((c) => c.id === notice?.id)
    offer.hidden = !notice || !card || card.availability !== 'ok' || card.level !== notice.level - 1
    if (!offer.hidden && notice && card) {
      offered = card.id; title.textContent = `${card.name} Lv${notice.level}`; detail.textContent = `${notice.price} 棱晶 · 点击购买`
      timer.textContent = notice.auto ? `${(notice.remainingTicks / 60).toFixed(1)} 秒后自动购买` : '手动购买'; offer.setAttribute('aria-label', `流派购买${card.name}`)
    } else offered = null
    if (mode === 'planned' && offer.hidden) layer.hidden = true
  }
  const interval = window.setInterval(render, 100)
  return { refresh: () => { favoriteSignature = ''; render() }, dispose: () => { clearInterval(interval); layer.remove() } }
}
