import { RELEASE_NOTES } from '../../content/changelog'
export function renderChangelogSection(): HTMLElement {
  const root = document.createElement('section'); root.className = 'changelog-page'; root.setAttribute('aria-label', '更新日志')
  const title = document.createElement('h1'); title.textContent = '更新日志'
  const intro = document.createElement('p'); intro.className = 'cards__intro'; intro.textContent = '版本变化记录。当前操作与玩法规则请查看帮助，卡片实际数值以升级面板为准。'; root.append(title, intro)
  for (const release of RELEASE_NOTES) {
    const card = document.createElement('article'); card.className = 'changelog-entry'
    const heading = document.createElement('h2'); heading.textContent = `v${release.version} · ${release.title}`
    const date = document.createElement('time'); date.dateTime = release.date; date.textContent = release.date
    const items = document.createElement('ul'); for (const item of release.items) { const row = document.createElement('li'); row.textContent = item; items.append(row) }
    card.append(heading, date, items); root.append(card)
  }
  return root
}
