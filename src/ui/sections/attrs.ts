import { armorToMitigation, type AttrSet } from '../../core/attrs'
import {
  MAX_MINES_PER_TEAM,
  MINE_BLAST_RADIUS,
  MINE_DAMAGE,
  MINE_PLACE_COOLDOWN_TICKS,
  MINE_SLOW_FACTOR,
  MINE_SLOW_RADIUS,
  MINE_TRIGGER_RADIUS,
} from '../../core/systems/mines'
import { TICK_RATE } from '../../core/types'
import { formatNumber } from '../cardInfo'

export interface PlayerView {
  readonly attrs: AttrSet
  readonly hp: number
  readonly shield: number
  readonly shieldCap: number
}

function row(label: string, value: string): HTMLElement {
  const line = document.createElement('div')
  line.className = 'attrs__row'
  const key = document.createElement('span')
  key.className = 'attrs__key'
  key.textContent = label
  const val = document.createElement('span')
  val.className = 'attrs__value'
  val.textContent = value
  line.append(key, val)
  return line
}

function group(title: string, rows: readonly HTMLElement[]): HTMLElement {
  const section = document.createElement('section')
  section.className = 'menu__section'
  const heading = document.createElement('h3')
  heading.className = 'menu__heading'
  heading.textContent = title
  const list = document.createElement('div')
  list.className = 'attrs__list'
  list.append(...rows)
  section.append(heading, list)
  return section
}

/** Live attribute sheet; every number comes from the resolved AttrSet. */
export function renderAttrsSection(view: PlayerView): HTMLElement {
  const { attrs } = view
  const wrapper = document.createElement('div')
  wrapper.className = 'attrs'

  const mitigation = armorToMitigation(attrs.armor)
  const dps = attrs.damage * attrs.fireRate * attrs.multishot

  wrapper.append(
    group('生存', [
      row('生命', `${Math.ceil(view.hp)} / ${formatNumber(attrs.maxHp)}`),
      row('护盾', `${Math.ceil(view.shield)} / ${formatNumber(view.shieldCap)}`),
      row('护甲', formatNumber(attrs.armor)),
      row('减伤', `${formatNumber(mitigation * 100)}%`),
      row('移动速度', `${formatNumber(attrs.speed)} /秒`),
      row('碰撞半径', formatNumber(attrs.radius)),
      row('复活次数', formatNumber(attrs.revives)),
    ]),
    group('火力', [
      row('单发伤害', formatNumber(attrs.damage)),
      row('射速', `${formatNumber(attrs.fireRate)} 发/秒`),
      row('理论 DPS', formatNumber(dps)),
      row('射程', formatNumber(attrs.range)),
      row('弹速', formatNumber(attrs.bulletSpeed)),
      row('穿透层数', formatNumber(attrs.pierce)),
      row('子弹大小', formatNumber(attrs.bulletSize)),
      row('护甲穿透', formatNumber(attrs.penetration)),
      row('内层伤害倍率', `×${formatNumber(attrs.innerDamageMult)}`),
      row('多重射击', formatNumber(attrs.multishot)),
    ]),
    group('恢复与收益', [
      row('吸血', `${formatNumber(attrs.lifesteal * 100)}%`),
      row('吸盾', `${formatNumber(attrs.shieldSteal * 100)}%`),
      row('棱晶收益', `×${formatNumber(attrs.shardGain)}`),
    ]),
    group('偏转力场', [
      row('状态', attrs.deflectLevel > 0 ? `Lv${attrs.deflectLevel}` : '未解锁'),
      row('力场半径', formatNumber(attrs.deflectFieldRadius)),
      row('力场强度', formatNumber(attrs.deflectFieldStrength)),
      row('主动窗口', `${formatNumber(attrs.deflectWindowSeconds)} 秒`),
      row('技能冷却', `${formatNumber(attrs.deflectCooldownSeconds)} 秒`),
      row('反射伤害倍率', `×${formatNumber(attrs.reflectDamageMult)}`),
    ]),
    group('地雷（装备固定值）', [
      row('伤害', formatNumber(MINE_DAMAGE)),
      row('爆炸半径', formatNumber(MINE_BLAST_RADIUS)),
      row('触发 / 减速半径', `${formatNumber(MINE_TRIGGER_RADIUS)} / ${formatNumber(MINE_SLOW_RADIUS)}`),
      row('减速幅度', `${formatNumber((1 - MINE_SLOW_FACTOR) * 100)}%`),
      row('同时存在上限', `${MAX_MINES_PER_TEAM}（满后替换最早的一颗）`),
      row('布置冷却', `${formatNumber(MINE_PLACE_COOLDOWN_TICKS / TICK_RATE)} 秒`),
    ]),
  )

  return wrapper
}
