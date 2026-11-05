# 07 · 成长、预设目录、每关存档与准备

适用v1.26，2026-11-05；数值版本7、存档外壳v1、实时协议 `prism-server-3`。本文与前六篇共同描述当前实现，使用说明见[服务器指南](../server-guide.md)。

## 1. 内容数据与执行优先级

| 实现 | 责任 |
|---|---|
| [cardLayout.ts](../../src/content/cardLayout.ts) | 七类目录、基础标签、同类卡片顺序 |
| [cards.ts](../../src/content/cards.ts) | 卡片函数、价格、说明、前置、效果与优先级 |
| [core/cards.ts](../../src/core/cards.ts) | 数字优先级排序、属性解析、数值有效性 |
| [sections/cards.ts](../../src/ui/sections/cards.ts) | 分类导航、收藏、购买筛选与优先级显示 |

55张卡全部由CARD_GROUPS映射一次。数量为武器6、伤害9、弹道8、防御与恢复7、地雷11、技能5、机动与辅助9。ALL_CARDS组装时应用展示分类与基础标签，并按目录顺序排序。resolveAttrs另按数字priority结算；调整显示顺序不会改变属性执行次序。

狙击手/动能狙击、电弧发生器/电容绕组、激光发射器/聚焦透镜分别相邻。其他关联卡也分组排列，例如射程/弹速/悬浮/追踪、穿透/弹射/贯穿推进、棱光护盾/护盾回充、偏转/反射。标签限于可观察的基础属性，不把玩家构筑名称放入标签。

## 2. 护盾、攻速与起始经济

shieldCap统一为 `max(0, maxHp × shieldCapMult)`，不再读取attrs.shield。PLAYER_BASE_ATTRS的shieldCapMult为0；棱光护盾n级增加0.1n系数，并固定增加1/s回复。50生命、一级盾为5上限，二级10；改变最大生命时上限联动。护盾回充独立每级+3/s，需要盾卡且有有效系数。

attrs.shield保留为敌人初始盾量，不是额外容量。核心守卫与铁壁卫士显式设置系数和初始盾。购买、回购不填充当前盾；出售经reapplyAttrs夹紧，脱战/禁盾/复活规则继续由原有系统执行。

动能狙击n级攻速为原值÷3ⁿ；cards.ts使用SNIPER_RULES同一来源生成数值与说明。伤害仍×2ⁿ、战斗移速×0.7ⁿ，脱战取消专精移速惩罚再×1.1。

DUNGEON_START_SHARDS当前为50，Game初始化所有正式新局（闯关、无尽）使用它；合作初始化、加入新席位和重开也各自50。读档恢复现有钱包，不额外发钱。核心createWorld仍不默认发放经济，避免纯模拟测试或其他模式被隐式改变；1v1保留自己的经济规则。

## 3. 敌人池与确定性

[difficulties.ts](../../src/content/difficulties.ts) 的每波数量系数：

`1.15 + 0.14d + 0.18r + 0.055rd`，其中d=房间索引/5，r=难度−1。每波数量向上取整，波次公式保留。合作再按在线人数缩放，继续执行原预算限制。

[dungeon.ts](../../src/content/dungeon.ts) 的dungeonEnemyPalette从游荡者、炮台、游猎、自爆开始；难度≥2或d≥0.8加入电弧游骑，难度≥3或d≥1.2加入铁壁卫士，难度≥4或d≥2加入灼线哨兵/核心守卫。非Boss且非保留首名精英时，以78%概率从池中取原型，再套难度、词条、出生安全检查。盘丝洞Boss保持固定设计。

[enemies.ts](../../src/content/enemies.ts) 复用现有AI而非建立另一套系统：铁壁卫士是有盾、护甲、格挡的chase近战；电弧游骑是skirmish侧移电武器，能够传导。测试场混合敌群和无尽抽样池也包含它们。抽样仅用注入RNG，同种子/难度/版本可复现；旧存档当前房间实体不重新生成，后续新房按新规则生成。

## 4. 偏好与购买授权分离

ControlSettings保存玩家希望采用的瞄准、开火、磁吸状态。设置页未持卡仍可切换，明确提示待购买。Game.panelState与ServerSession.panelState返回原始偏好，不用角色数值伪造当前选中项；购买、出售、测试授卡不覆盖偏好。

实际输入由角色autoAim/autoFire与偏好共同决定，磁吸由pickupRadius与autoPickup共同决定。无卡时仍可手动操作；自动模式的射程、可见性和无目标回退规则保持。合作服务器继续校验卡片授权，客户端选项不能免费开启功能。

## 5. 预设编辑与存储

[sections/plans.ts](../../src/ui/sections/plans.ts)采用目录和有序列表双区，窄屏堆叠。目录搜索名称/标签/分类，可筛分类、仅收藏；点击卡片追加，数量框一次1–50次。编辑器筛选、数量、前置选择、目录滚动存sessionStorage，整体菜单刷新后仍保留；保存预设与收藏编辑放在details中，优先呈现编辑区域。

[upgradePlans.ts](../../src/app/upgradePlans.ts)的新函数：

- appendPresetTargets：复制草稿、递归插入缺少的卡片前置，检查循环，按原顺序追加目标；单次机制只追加一次；整体校验成功才返回。
- duplicatePresetTarget：在所选项后插入同卡下一级，后续同卡等级顺延，不全局重排。
- presetCost：从零按每一项实际经过的等级累加priceFn，目标跨级也包括中间购买成本。

[planManager.ts](../../src/app/planManager.ts)在成功返回后替换draft，失败只更新消息。列表保留逐项改等级、移动、删除；保存、再编辑、导入、导出继续用prism-build v2。编辑草稿不会立刻买卡；载入预购后仍服从余额、前置与三秒提示规则。UI批量上限是单次编辑操作限制，不是卡片成长上限。

## 6. 自动保存策略

[autoSave.ts](../../src/app/autoSave.ts)只维护最后成功保存的key与时间，不依赖DOM或World。due规则：key有效、模式非off，且key改变或interval达到时间间隔。失败不调用saved，因此下次会重试。

| 模式 | 单人自动槽/合作进度快照 |
|---|---|
| room（默认） | 新局/正式开始、每次切关保存一次 |
| interval | 上述边界以及指定间隔，默认60秒，允许5–3600秒 |
| off | 停止自动进度快照；手动槽/导出不受影响 |

Game.autoSaveKey用种子、重开次数、模式和实际房间/无尽层数生成；main另加会话编号区分同种子新局。onRoomChange在applyRoom或无尽推进后调用，立刻保存新房状态。一秒维护轮询先比较廉价key，同房不捕获、不序列化。页面隐藏与菜单保存请求也服从同一策略，不额外强制写入。

SaveManager写成功才更新策略；名称保留、失败提示和手动槽沿用现有实现。SettingsStore升为v4，v1–3偏好默认补room/60，不改变已有操作开关。

服务器使用同一策略，进度key包括合作房间ID、epoch、started和CoopMatch.progress；后者在无尽返回实际floor，避免roomIndex始终0漏掉保存与epoch边界；epoch也区分同一房间重开后的相同进度。切房后tickRoom更新epoch并触发saveProgress。定时维护每秒检查一次。多合作房间使用聚合key，任一房推进时原子保存整个服务器数据库。

autoSave.mode/seconds可在JSON配置，PRISM_AUTOSAVE/PRISM_AUTOSAVE_SECONDS优先覆盖。off仅关闭自动进度快照：身份、席位、权限等元数据变更、手动save与正常退出仍保存数据库，以免身份绑定与世界不一致。训练World永不存入正式进度。

## 7. 准备和倒计时

RoomMember.ready再次作为网络状态。房主不需额外准备，队员初始false；ready命令只能在等待大厅由非房主切换，携带roomId/epoch并校验身份。取消准备会清startTicks。未准备不限制训练输入或试卡。

scheduleStart要求所有在线非房主已准备，成功后仍300tick。加入、掉线、取消、转让会中止倒计时；重开和1v1新回合重置队员准备。正式开局清训练输入与世界，保留钱包和构筑。

ServerSession场边快捷按钮：房主为开始，在线队员未准备时禁用并显示人数；队员为准备/取消准备，倒计时内仍能取消。房间管理页也有对应操作。暂停中的正式合作继续不重新做大厅准备。

## 8. 数值版本7迁移

[legacyCardsV6.ts](../../src/content/legacyCardsV6.ts)冻结此前卡片公式，[legacyPlayer.ts](../../src/content/legacyPlayer.ts)冻结原初始系数1。单人接受1–6历史数值，合作接受5–6；当前为7。

先选择旧卡表、补历史新增字段，校验旧base与每个角色的旧购买解析结果，再按当前PLAYER_BASE_ATTRS重新解析并夹紧生命/盾量。逐人迁移时，即使前一人已经更新世界base，后一人验证仍使用对应版本的冻结base，避免多人第二个席位误判。保留钱包、实际支付、命名、种子、关卡、已飞行弹丸与资源状态；迁移不重新授予起始经济，不补满盾。

## 9. 测试入口与边界

新增[balanceV7.test.ts](../../tests/unit/balanceV7.test.ts)、[roomAutoSave.test.ts](../../tests/unit/roomAutoSave.test.ts)、[presetEditor.test.ts](../../tests/unit/presetEditor.test.ts)，并扩展game/coop/server/serverSession/serverConfig测试。覆盖冻结旧档与离线席位、盾上限与固定回复、狙击÷3、目录标签、种子敌人、新局经济、偏好与持卡分离、每关写入、失败重试、真实WebSocket准备/倒计时、DOM快捷按钮和编辑目录。

WebSocket测试是本机真实socket，UI测试是Happy DOM；不等同于五设备外网或真实触屏浏览器网络验收。构建和GitHub Actions继续验证客户端、服务器包与Pages发布。

## 10. 按武器筛选的角色属性与雷达

[attributeModel.ts](../../src/ui/attributeModel.ts)是只读展示模型，输出AttributeGroup→AttributeBlock→AttributeRow及AttributeRadar→RadarAxis。每个相关属性族作为block保序；关键或偏离标准基础的block默认可见，其他基础块进入“更多基础属性”。未选择的机制与其他武器属性不进入模型，即使展开也不混入。狙击上限、追踪、电容、聚焦、子雷和技能各有激活门控。

attributeReference通过当前内容管线给标准基础角色只装备当前武器；它只是比较参考，不写回World，模式、购卡、临时增益和脱战速度都可以产生偏离。标记不宣称所有变化都来自购卡。菜单继续传入PlayerView，单人/测试/合作/1v1复用，不需要额外网络字段或存档升级。

weaponMetrics用共享core/rules派生激光脉冲、真实射程、持续时间、含持续攻击的完整周期频率；电弧展示基础首击，不提前假定目标数量或剩余穿透奖励；狙击满速命中估算保留速度基础伤害乘区。移除原先笼统的理论DPS，避免不同武器被不成立的齐射公式比较。

[attributeRadar.ts](../../src/ui/attributeRadar.ts)用原生SVG绘制六轴网格、基础虚线、当前实线和节点。每轴单独以v/(v+s)归一化，s为50%半径参考值；一般为当前武器标准基础值，基础为零的护盾、护甲减伤、吸血用50、0.5、0.1。基线自身为零的轴仍画零，不把虚线强制画成正六边形。缩放只限制图形半径，不限制属性成长，原始数值和单位保留。

两张常驻图分别为武器、生存机动；有雷场升级时增加第三张。图内标签、SVG标题/描述、可展开的精确数值/参考表兼顾读屏与颜色识别；更高数值并不等于综合战力，不输出伤害评分。样式在app/style.css，窄屏单列，不另引图表依赖。更多属性和各图数据表的展开状态保存在sessionStorage。

[attributeSheet.test.ts](../../tests/unit/attributeSheet.test.ts)覆盖四武器门控、狙击一弹、未解锁机制、变化属性族提升、邻接关系、盾与持续周期公式、零射速、六轴/单位/归一化、极大数值、DOM可访问说明和展开状态；展示不改原始attrs。
