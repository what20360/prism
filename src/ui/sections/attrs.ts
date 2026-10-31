import { armorToMitigation, type AttrSet } from '../../core/attrs'
import { formatNumber } from '../cardInfo'
import { homingProfile, penetrationProfile, mineSlowMultiplier, WEAPON_RULES, ARSENAL_RULES, arcProfile, pulseProfile, broodProfile } from '../../core/rules'

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
  const homing = homingProfile(attrs.homing)
  const dps = attrs.damage * Math.min(attrs.fireRate, 60 / Math.max(1, (attrs.burstCount - 1) * WEAPON_RULES.burstGapTicks + 1)) * attrs.multishot * attrs.burstCount

  wrapper.append(
    group('生存', [
      row('生命', `${Math.ceil(view.hp)} / ${formatNumber(attrs.maxHp)}`),
      row('护盾', `${Math.ceil(view.shield)} / ${formatNumber(view.shieldCap)}`),
      row('固定格挡', formatNumber(attrs.block)),
      row('物理 / 电 / 热抗性', `${formatNumber(attrs.physicalResist)} / ${formatNumber(attrs.electricResist)} / ${formatNumber(attrs.heatResist)}`),
      row('护甲', formatNumber(attrs.armor)),
      row('减伤', `${formatNumber(mitigation * 100)}%`),
      row('移动速度', `${formatNumber(attrs.speed)} /秒`),
      row('碰撞半径', formatNumber(attrs.radius)),
      row('复活次数', formatNumber(attrs.revives)),
    ]),
    group('火力', [
      row('主武器', attrs.weapon === 1 ? '电弧 · 电伤' : attrs.weapon === 2 ? '激光 · 热伤' : '弹芯枪 · 物理'),
      row('单发伤害', formatNumber(attrs.damage)),
      row('射速', `${formatNumber(attrs.fireRate)} 发/秒`),
      row('理论 DPS', attrs.weapon === 0 ? formatNumber(dps) : '依目标与穿透；可在测试场测量'),
      row('射程（路径距离）', formatNumber(attrs.range * (attrs.weapon === 2 ? ARSENAL_RULES.laserRange : 1))),
      row('弹速', formatNumber(attrs.bulletSpeed)),
      row('发射初速 / 最高弹速', `${formatNumber(attrs.bulletSpeed * homing.initialMultiplier)} / ${formatNumber(attrs.bulletSpeed * homing.cruiseMultiplier)}`),
      row('穿透层数', formatNumber(attrs.pierce)),
      row('贯穿推进', attrs.pierceBoost > 0 ? `每次速度 ×${formatNumber(penetrationProfile(attrs.pierceBoost).speedMultiplier)}，射程 +${formatNumber(penetrationProfile(attrs.pierceBoost).rangeGain)}` : '未解锁'),
      row('子弹大小', formatNumber(attrs.bulletSize)),
      row('护甲穿透', formatNumber(attrs.penetration)),
      row('内层伤害倍率', `×${formatNumber(attrs.innerDamageMult)}`),
      row('多重射击', formatNumber(attrs.multishot)),
      row('弹射', attrs.ricochet > 0 ? '每次消耗 1 穿透' : '未解锁'),
      row('连发轮数', formatNumber(attrs.burstCount)),
      row('电弧传导保留 / 强化', `${formatNumber(arcProfile(attrs.arcEfficiency).retention * 100)}% / ${formatNumber(arcProfile(attrs.arcEfficiency).boostedRetention * 100)}%`),
      row('激光脉冲 / 照射时间', `${formatNumber(attrs.damage * ARSENAL_RULES.laserDamage * (1 + 0.2 * attrs.laserPower))} / ${formatNumber(ARSENAL_RULES.laserTicks * attrs.burstCount / 60)} 秒`),
      row('追踪转速', attrs.homing > 0 ? `${formatNumber(homing.turnRate)} 弧度/秒` : '未解锁'),
      row('同时存在子弹', attrs.maxProjectiles > 0 ? `${attrs.maxProjectiles} 颗` : '不限'),
      row('视野倍率', `×${formatNumber(attrs.vision)}`),
      row('弹丸爆炸半径', formatNumber(attrs.blastRadius)),
      row('自动索敌 / 扳机', `${attrs.autoAim > 0 ? '已装配' : '未购买'} / ${attrs.autoFire > 0 ? '已装配' : '未购买'}`),
    ]),
    group('恢复与收益', [
      row('击杀晶片 / 血球等级', `${formatNumber(attrs.mineShardChance)} / ${formatNumber(attrs.bloodOrbChance)}`),
      row('吸血', `${formatNumber(attrs.lifesteal * 100)}%`),
      row('吸盾', `${formatNumber(attrs.shieldSteal * 100)}%`),
      row('棱晶收益', `×${formatNumber(attrs.shardGain)}`),
      row('磁铁吸取半径', attrs.pickupRadius > 0 ? formatNumber(attrs.pickupRadius) : '未解锁'),
    ]),
    group('偏转力场', [
      row('状态', attrs.deflectLevel > 0 ? `Lv${attrs.deflectLevel}` : '未解锁'),
      row('力场半径', formatNumber(attrs.deflectFieldRadius)),
      row('力场强度', formatNumber(attrs.deflectFieldStrength)),
      row('主动窗口', `${formatNumber(attrs.deflectWindowSeconds)} 秒`),
      row('技能冷却', `${formatNumber(attrs.deflectCooldownSeconds / attrs.skillCooldownRate)} 秒`),
      row('反射伤害倍率', `×${formatNumber(attrs.reflectDamageMult)}`),
    ]),
    group('雷场装备', [
      row('每段伤害 / 段数', `${formatNumber(attrs.mineDamage / pulseProfile(attrs.minePulseLevel).divisor)} / ${pulseProfile(attrs.minePulseLevel).count}`),
      row('子雷数量 / 继承', attrs.mineBroodLevel > 0 ? `${broodProfile(attrs.mineBroodLevel).children} / ${formatNumber(broodProfile(attrs.mineBroodLevel).inherit * 100)}%` : '未解锁'),
      row('子雷独立上限', attrs.mineBroodLevel > 0 ? String(Math.floor(attrs.mineLimit * broodProfile(attrs.mineBroodLevel).capMultiplier)) : '未解锁'),
      row('爆炸半径', formatNumber(attrs.mineBlastRadius)),
      row('侦测 / 减速半径', `${formatNumber(attrs.mineTriggerRadius)} / ${formatNumber(attrs.mineSlowRadius)}`),
      row('减速倍率', `÷${formatNumber(mineSlowMultiplier(attrs.mineSlowMultiplier, attrs.mineIgnoreBullets > 0))}`),
      row('本体生命 / 引爆延迟', `${formatNumber(attrs.mineHp)} / ${formatNumber(attrs.mineFuseSeconds)} 秒`),
      row('手榴弹 / 破片', `${attrs.grenade > 0 ? '已启用' : '未启用'} / ${attrs.mineFragments} 颗`),
      row('同时存在上限', `${Math.floor(attrs.mineLimit)}（满后替换最早的一颗）`),
      row('布置冷却', `${formatNumber(attrs.mineCooldown / attrs.mineCooldownRate)} 秒`),
    ]),
  )

  return wrapper
}
