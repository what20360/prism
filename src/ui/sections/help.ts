import { SKILL_DESCRIPTIONS } from '../../content/skills'
import { ALL_CARDS, CARD_REGISTRY } from '../../content/cards'
import { CARD_ECONOMY } from '../../core/rules'
import { formatRuleNumber as fmt } from '../../content/format'
const cardRule = (id: string): string => CARD_REGISTRY.get(id)?.summary?.(1) ?? ''
type Entry = { term: string; text: string }
const CHAPTERS: readonly { id: string; title: string; entries: readonly Entry[] }[] = [
  { id: 'start', title: '快速上手', entries: [
    { term: '选择模式', text: '主菜单选择“开始闯关”进入地牢，或进入“测试模式”自由比较构筑。帮助与设置也可以直接在主菜单查看。' },
    { term: '第一步 · 移动', text: 'WASD / 方向键移动；手机轻推左摇杆慢走，推远全速移动。离开入口后才开始刷怪。' },
    { term: '第二步 · 射击', text: '默认手动瞄准和射击：鼠标指向目标并按住左键；手机按住右摇杆射击，拖动改变枪口方向。' },
    { term: '第三步 · 升级', text: `造成伤害获得棱晶，打开菜单的升级面板购买卡片。当前共 ${ALL_CARDS.length} 张卡，点击分类标题可折叠或展开。` },
    { term: '第四步 · 推进', text: '清空敌人后走入顶部传送门。共 5 层，每层 5 房，最后挑战 Boss；死亡或通关后可重新开始。' },
  ] },
  { id: 'controls', title: '操作与菜单', entries: [
    { term: '键鼠', text: 'WASD / 方向键移动，鼠标瞄准，左键按住射击，E 放置地雷，J / K 使用技能槽 1 / 2。右键点击敌人锁定，右键空白取消手动锁定；左键只负责射击。' },
    { term: '触屏', text: '左摇杆移动，右摇杆瞄准并射击；独立地雷与两个技能按钮可同时触摸。直接点敌人锁定、点空白取消。未装备的技能按钮呈灰色。' },
    { term: '菜单', text: 'Esc 或右上菜单按钮暂停。升级、主动技能、角色属性、帮助和设置都在同一菜单；可以返回主菜单，再点“继续本局”回到原来的战斗时刻。开始闯关或测试模式会替换当前局。' },
    { term: '重新开始', text: '结算后按 R 或点“再开一局”；局中可从菜单重新开始。新局清空购买与进度，保留浏览器设置。' },
    { term: '声音与设置', text: '首次点击、触摸或按键后启用声音。音乐、音效、操作偏好和触屏显示设置自动保存；设置不会免费解锁自动操作卡。' },
  ] },
  { id: 'practice', title: '测试模式', entries: [
    { term: '场景配置', text: '右上“测试控制”可选择固定靶机或敌人演练、开阔或掩体场地，并设置 1–12 个目标、生命与护甲。固定靶机被击败后恢复；敌人演练使用实际追击与炮台行为。' },
    { term: '自由构筑', text: '默认开启玩家无敌与自由购卡。升级面板可直接设定非负整数卡片等级，0 为移除；成长卡不限等级，纯功能开关仅解锁一次，可绕过前置比较组合。关闭自由购卡后，场景重置为 1000 棱晶，购买使用正常价格。' },
    { term: '伤害统计', text: '总伤害只记录实际扣除的生命与护盾，不计溢出。近 3 秒 DPS 为最近 180 个逻辑 tick 的伤害除以 3；平均 DPS 为重置统计后的总伤害除以战斗时间。暂停与主菜单期间不计时。' },
    { term: '重置与恢复', text: '应用配置或重置场景会保留卡片与技能槽，并重置目标、生命、冷却和统计；可以单独重置统计、清除弹幕地雷或恢复生命冷却。“重置构筑与场景”清空卡片。' },
    { term: '会话独立', text: '测试场不进入下一房间。无敌、资源、卡片和统计不会带入正常闯关；关闭无敌后可以正常受伤与死亡，结算页可以重新测试或返回主菜单。' },
  ] },
  { id: 'lock', title: '锁定与自动操作', entries: [
    { term: '手动锁定', text: '桌面右键点击敌人、手机轻点敌人固定目标，金色框表示手动锁定。只要目标仍存活且在当前房间，就不会自动换目标；死亡、切房或取消后解除。' },
    { term: '方向锁定', text: '没有手动目标时，系统沿攻击方向选择前方可见敌人，用青色框表示；自动选择会避开墙后目标。' },
    { term: '目标信息', text: '锁定后持续显示名称、生命、护盾、护甲、移速、伤害和攻速，移出画面后仍保留信息卡。' },
    { term: '自动瞄准', text: '购买“自动索敌”后，枪口朝锁定目标转向。只锁定目标不会免费获得自动瞄准；手动模式仍按鼠标或右摇杆方向射击。' },
    { term: '自动射击', text: '“自动扳机”独立控制开火，两张自动卡可分别购买和出售。设置页可以暂时关闭已购买的自动功能。' },
    { term: '追踪子弹', text: `追踪 Lv1：${cardRule('homing')}。子弹朝共享锁定目标偏转，不能穿墙；转向速度随等级缓慢成长。` },
  ] },
  { id: 'skills', title: '主动技能与装备', entries: [
    { term: '两个槽位', text: '可以拥有多个主动技能，同时只能携带两个。购买时优先填入空槽；槽位满后，新技能保留在已拥有列表，到“主动技能”页换装。' },
    { term: '换装规则', text: 'J / K 对应槽位 1 / 2；触屏按钮显示当前技能名称。换装不会清除冷却，卸下技能会立即结束它的主动效果。暂停期间冷却停止。' },
    { term: '偏转 / 反射', text: SKILL_DESCRIPTIONS.deflect },
    { term: '狂暴', text: SKILL_DESCRIPTIONS.rage },
    { term: '冲刺', text: SKILL_DESCRIPTIONS.dash },
    { term: '技能成长', text: '狂暴升级提高伤害、护甲、攻速与吸血；冲刺升级提高加速倍率。战术整备提高所有主动技能的冷却速度；偏转的力场、窗口和反射倍率由对应卡片强化。永久属性与临时技能效果分别计算。' },
  ] },
  { id: 'cards', title: '卡片、优先级与回收', entries: [
    { term: '数字优先级', text: '卡片按页面显示的优先级结算，数值越小越先；同值按固定顺序。购买顺序不会改变最终结果。基础属性通常先于复合机制，最终生命比例在 1000 阶段计算。' },
    { term: '百分比生命', text: '胆小鬼和玻璃大炮按最终最大生命扣减；先买生命卡再买姿态，或反过来，结果一致。降低上限时当前生命也会限制在新上限内。' },
    { term: '购买与前置', text: `每张卡显示下一级累计效果、价格和前置，数值与文案共用成长函数。价格 = round(首价 × ${fmt(CARD_ECONOMY.growth)}^(等级−1))；未满足前置时不能购买。成长卡不限等级，纯功能开关仅解锁一次。` },
    { term: '出售', text: `标有“可回收”的卡可以出售一级，返还该级实际支付价格的 ${fmt(CARD_ECONOMY.refundRatio * 100)}%，向下取整。已拥有的依赖卡仍需要它时，不能出售前置卡。` },
    { term: '分类折叠', text: '点击分类标题展开或收起该类卡片；购买、出售刷新面板后保留折叠状态。角色属性页可查看当前实际生效的数值。' },
  ] },
  { id: 'bullets', title: '弹道组合与流派', entries: [
    { term: '连发 × 霰弹', text: '连发沿释放时同一朝向依次发射；霰弹让每一轮同时向多个方向发射。总弹数等于连发轮数 × 每轮弹数，伤害、射程和初速代价同时生效。' },
    { term: '弹射与穿透', text: '先购买穿透弹才能解锁弹射。每次撞墙消耗 1 穿透，必须至少保留 1 穿透继续飞行；命中敌人也会消耗穿透。' },
    { term: '狙击手', text: `Lv1：${cardRule('precision-stance')}。不额外扣减追踪转速，高速本身使转弯半径增大。连发等待弹位空出，夺回的子弹也受限。` },
    { term: '飞剑构筑', text: `${cardRule('suspension')}。组合追踪、加长枪管、穿透和连发/霰弹，能形成停留更久的回旋弹幕。降低弹速也会减慢命中，快速目标仍可能逃开。` },
    { term: '射程是距离', text: '射程按累计飞行路径扣减：追踪转弯和墙体弹射都消耗路程，雷场只按减速后的实际路程扣减。没有固定存活时间；同射程的慢弹存在更久。命中、穿透耗尽、撞墙或切房仍可提前清除弹丸。' },
    { term: '核心命中', text: '沿目标核心射线命中且剩余穿透至少为 2 时，造成内层倍率伤害并消耗 2 穿透；普通外层命中消耗 1。核心圈按真实判定范围显示。' },
    { term: '姿态与视野', text: '胆小鬼偏机动，重炮手偏护甲与重击，玻璃大炮以生命换输出，狙击手偏远射；登高者扩大可见世界范围。姿态可以组合，但代价也会叠加。' },
    { term: '爆破与清弹', text: '星爆弹头会对命中点附近敌人造成范围伤害，范围部分不重复核心加成。子弹之间不碰撞；清除敌方弹幕依靠地雷爆炸或主动偏转。' },
  ] },
  { id: 'mines', title: '地雷、手榴弹与拾取', entries: [
    { term: '基础地雷', text: 'E 或地雷按钮放置，不消耗棱晶。初始上限 3，达到上限后替换自己最早的一颗；数量、布雷冷却速度和伤害可分别升级。' },
    { term: '三个半径', text: '侦测半径决定何时触发，减速半径决定雷场覆盖，爆炸半径决定伤害和清弹范围；三者分别升级。' },
    { term: '减速倍率', text: '雷场内敌方弹速 = 弹丸自身速度 ÷ 减速倍率。初始倍率 2，即半速；多个雷场重叠时取最强倍率，不叠乘。蛛网提升倍率。' },
    { term: '无视', text: '子弹不能触发或击毁地雷，敌人靠近仍会触发；倍率超过 1 的部分只保留 45%，因此雷场减速变弱。爆炸仍能清除敌方子弹。' },
    { term: '手榴弹', text: '沿释放时的移动方向缓慢前进，静止时沿枪口方向；到达行程或撞墙后开始引爆。途中遇敌人也可提前触发。' },
    { term: '迟钝与破片', text: '迟钝需先解锁手榴弹，增加本体生命和引爆延迟；较长延迟会显示倒计时。破片使爆炸径向发射继承玩家弹丸属性的子弹，受狙击手限制。' },
    { term: '美食家与掘金者', text: '子弹造成有效伤害时，美食家可能产生回血的血球；地雷造成有效伤害时，掘金者可能产生增加棱晶的晶片。靠近拾取，磁吸核心扩大吸引范围。' },
  ] },
  { id: 'survival', title: '生存、收益与画面反馈', entries: [
    { term: '护甲与护盾', text: '护甲减伤 = 护甲 ÷ (100 + 护甲)。护盾先承受剩余伤害；吸盾与护盾回复不能超过护盾上限，回复需一段时间未受伤。' },
    { term: '棱晶收益', text: '收益主要按造成的有效伤害结算，溢出伤害按 50% 计入；受伤也按规则产生收益。自动结算的棱晶不需拾取，掘金者额外生成的晶片需拾取。' },
    { term: '冷却环', text: '角色周围青色环为射击，技能环与已装备技能对应，金色环为地雷。射击完整冷却低于 0.30 秒、技能低于 0.50 秒时隐藏对应环，避免闪烁。' },
    { term: '方向与颜色', text: '渐隐长光束表示枪口朝向，分离推进纹表示移动方向。玩家弹偏青，敌方弹偏红；球形弹头后的拖尾反映实际速度与轨迹。' },
    { term: '数字反馈', text: '白色为伤害，金色“溢”为溢出，红色负数为承伤，青色 ◆ 为棱晶，绿色正数为治疗。锁定信息卡持续显示，普通命中信息短暂显示。' },
    { term: '复活与新局', text: '备用核心提供本局复活次数；用尽后死亡进入结算。局内进度不会保存，刷新页面会返回主菜单。' },
  ] },
]
export function renderHelpSection(): HTMLElement {
  const root = document.createElement('div'); root.className = 'help'
  const title = document.createElement('h2'); title.textContent = 'PRISM 战斗手册'
  const intro = document.createElement('p'); intro.className = 'cards__intro'; intro.textContent = '从这里开始，或点击目录查找机制。每章都可以折叠。'
  root.append(title, intro)
  const nav = document.createElement('nav'); nav.className = 'help__toc'; nav.setAttribute('aria-label', '帮助目录'); root.append(nav)
  for (const chapter of CHAPTERS) {
    const section = document.createElement('details'); section.className = 'help__chapter'; section.open = chapter.id === 'start'; section.id = `help-${chapter.id}`
    const summary = document.createElement('summary'); summary.textContent = chapter.title; section.append(summary)
    const button = document.createElement('button'); button.className = 'settings__option'; button.textContent = chapter.title
    button.onclick = () => { section.open = true; section.scrollIntoView({ behavior: 'smooth', block: 'start' }) }; nav.append(button)
    for (const entry of chapter.entries) {
      const row = document.createElement('div'); row.className = 'help__row'
      const term = document.createElement('strong'); term.className = 'help__term'; term.textContent = entry.term
      const text = document.createElement('span'); text.textContent = entry.text; row.append(term, text); section.append(row)
    }
    root.append(section)
  }
  return root
}
