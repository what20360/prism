import type { RunSummary } from '../app/game'

export interface ResultPanelHandlers {
  readonly onRestart: () => void
}

export interface ResultPanel {
  show(summary: RunSummary): void
  hide(): void
  readonly visible: boolean
}

export function createResultPanel(root: HTMLElement, handlers: ResultPanelHandlers): ResultPanel {
  const overlay = document.createElement('div')
  overlay.className = 'panel panel--result'
  overlay.hidden = true

  const title = document.createElement('h2')
  const subtitle = document.createElement('p')
  subtitle.className = 'result__subtitle'

  const grid = document.createElement('dl')
  grid.className = 'result__grid'

  const restart = document.createElement('button')
  restart.className = 'panel__close result__restart'
  restart.textContent = '再开一局 (R)'
  restart.addEventListener('click', () => handlers.onRestart())

  overlay.append(title, subtitle, grid, restart)
  root.append(overlay)

  const row = (label: string, value: string): void => {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    grid.append(dt, dd)
  }

  const show = (summary: RunSummary): void => {
    title.textContent = summary.victory ? '通关' : '失败'
    title.className = summary.victory ? 'result__title result__title--win' : 'result__title'
    subtitle.textContent = `到达 F${summary.floor}-${summary.room}`

    grid.replaceChildren()
    row('用时', `${Math.floor(summary.seconds / 60)}:${String(summary.seconds % 60).padStart(2, '0')}`)
    row('击杀', `${summary.kills}`)
    row('核心命中', `${summary.coreHits}`)
    row('最高连杀', `${summary.bestChain}`)
    row('得分', `${summary.score}`)
    row('棱晶', `${summary.shards}`)

    overlay.hidden = false
  }

  const hide = (): void => {
    overlay.hidden = true
  }

  return {
    show,
    hide,
    get visible() {
      return !overlay.hidden
    },
  }
}
