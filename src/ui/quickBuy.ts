import type { CardState } from '../core/progress'
export function createQuickBuy(root: HTMLElement, options: { active: () => boolean; slots: () => readonly (string | null)[]; cards: () => readonly CardState[]; buy: (id: string) => void }) {
  const layer = document.createElement('aside'); layer.className = 'quick-buy'; layer.setAttribute('aria-label', '快捷购买'); layer.hidden = true
  const toggle = document.createElement('button'); toggle.className = 'quick-buy__toggle'; toggle.textContent = '快捷购卡'; toggle.onclick = () => layer.classList.toggle('is-open')
  const tray = document.createElement('div'); tray.className = 'quick-buy__tray'; layer.append(toggle, tray); root.append(layer)
  let signature = ''
  const render = () => {
    const active = options.active(), slots = options.slots(); layer.hidden = !active || !slots.some(Boolean)
    if (!active) return
    const cards = options.cards(), next = JSON.stringify(slots.map((id) => cards.find((c) => c.id === id)))
    if (next === signature) return
    signature = next; tray.replaceChildren()
    for (const [index, id] of slots.entries()) {
      const card = cards.find((c) => c.id === id); if (!card) continue
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quick-buy__card'
      button.textContent = `${index + 1} · ${card.name}  ${card.price}◆`; button.setAttribute('aria-label', `快捷购买${card.name}`); button.title = `${card.name} Lv${card.level + 1} · ${card.summary}`
      button.disabled = card.availability !== 'ok'; button.onclick = () => { options.buy(card.id); signature = ''; render() }; tray.append(button)
    }
  }
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]') || !options.active() || !/^Digit[1-5]$/.test(event.code)) return
    const id = options.slots()[Number(event.code.slice(-1)) - 1], card = options.cards().find((c) => c.id === id)
    if (card?.availability === 'ok') { event.preventDefault(); options.buy(card.id); signature = ''; render() }
  }
  window.addEventListener('keydown', onKey); const timer = window.setInterval(render, 250)
  return { refresh: () => { signature = ''; render() }, dispose: () => { clearInterval(timer); window.removeEventListener('keydown', onKey); layer.remove() } }
}
