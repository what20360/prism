# PRISM 技术手册（三）：客户端、存储、联机与维护

依据 **2026-11-04 核对的代码基线 `828c4a9e`**。架构、World 与 tick 顺序见 [第一篇](01-architecture-and-simulation.md)，武器与模式机制见 [第二篇](02-combat-content-and-modes.md)。本篇重点解释外层如何驱动核心，以及文件/网络数据如何安全地变成运行时对象。

**当前规则：v1.26（2026-11-05）。战斗迁移见[第四篇](04-sniper-combat-and-presentation.md)，服务器、身份与差量同步见[第五篇](05-server-and-replication.md)，等待大厅与运维见[第六篇](06-waiting-and-server-operations.md)，成长、预设与存档策略见[第七篇](07-growth-presets-and-autosave.md)。基线链接用于追溯，当前实现以本分支源码为准。**

## 1. 浏览器启动与会话生命周期

入口 HTML：[index.html](../../index.html)；模块装配：[app/main.ts](../../src/app/main.ts)。页面只需要 `canvas#game`，其余菜单和触控 DOM 由代码创建。

启动依次完成：

1. 创建 Canvas Renderer、键盘源、PointerSource、SettingsStore 与 AudioEngine。
2. 读取浏览器偏好，建立触屏控制；第一次 pointerdown/keydown 负责尝试解锁声音。
3. 创建 SaveManager、PlanManager、边缘 QuickBuy。它们通过回调获取当前会话，避免固定绑定到某个已经被替换的 World。
4. 创建主页、单人菜单和结算面板。
5. `launch('dungeon','home')` 先建立可绘制的单人世界，但处于 home，未正式开局，checkpoint 不应产生一个虚假的进行中存档。
6. 启动每秒策略检查，以及切房、pagehide/visibilitychange的保存请求；默认同关只写一次，见第七篇。

### 1.1 launch 与模式切换

`launch` 在替换单人会话前尝试自动保存，再 dispose 旧 Game、清输入、关面板，组装 PracticeMode 或 EndlessMode，注入内容、种子、难度、快照和 UI 回调，最后 start 新 Game。

Game 的 `UiMode` 只有 play/menu/home。`setUiMode` 会清输入、清累积步长、重置购卡提示，再决定 world.paused。新 UI mode 通知 main 更新 DOM 可见性；结算则由 onRunEnd 单独打开 resultPanel。

进入联网时，`openServer`/`createServerSession` 保存并停止原 Game 的循环，创建一个独立网络 Session；离开时 dispose 对应 Session、重置输入、恢复主页和原 Game。这不是把所有模式都塞进一个永远运行的循环。

### 1.2 start、stop、dispose、restart 的区别

| 操作 | 单人 Game | 网络 Session |
|---|---|---|
| start | 开启 RAF 循环，重置墙钟/累积量 | 创建 Session 时启动自己的循环 |
| stop | 取消当前 RAF，不删除世界 | 会话关闭由 dispose 统一处理 |
| dispose | stop 并清意图集合；共享输入/渲染器归 main 管 | 取消 RAF、断开连接、删专属 DOM/监听、清输入 |
| restart | 新 World、清购买/预购和计量，保留设置；种子闯关/无尽保留种子 | 对战通过再战状态机；合作房主重建世界但保留席位 |

主页和暂停的切换不能只改 DOM hidden；如果世界 paused、输入按下状态、结算遮罩和帧时钟没有同时处理，就会出现“已重开但仍停在旧界面”等问题。[game.test.ts](../../tests/unit/game.test.ts) 以注入的假输入/Renderer 测试生命周期。

DEV 下 main 会暴露 `window.__prism` 读取当前单人 Game；生产构建不暴露。该调试入口不是稳定的游戏接口，也不能替代真实菜单/联网流程验收。

## 2. 输入：连续状态与一次性事件

### 2.1 键盘与绑定

[keyboard.ts](../../src/input/keyboard.ts) 用 pressed Set 记录持续按键，用 restartRequested/menuToggleRequested 记录每次按下仅消费一次的事件。keydown 忽略可编辑 DOM、Ctrl/Alt/Meta 快捷键和无关按键；blur/reset 清状态，避免窗口失焦后持续移动。

read 返回方向、布雷与技能槽；移动向量归一，避免斜向加速。consumeRestart/consumeMenuToggle 读取后清标志，重开只在结束画面等允许阶段触发。方向键作为移动备用，即使用户改了 WASD 绑定仍然接受。

[bindings.ts](../../src/input/bindings.ts) 单独保存 9 个动作的 KeyboardEvent.code，缓存于模块 current，持久化键是 `prism.bindings`。`setBinding` 拒绝重复键和不在允许代码集合中的输入；[sections/keys.ts](../../src/ui/sections/keys.ts) 负责下一次按键捕获、显示和重置。它不属于 ControlSettings 的版本化 JSON。

### 2.2 PointerSource

[pointer.ts](../../src/input/pointer.ts) 保存最新 viewport CSS 坐标、左键持续状态和 pendingLock。右键只排入锁定请求并禁止浏览器上下文菜单；触摸 canvas 是点选锁定，不在此处充当射击摇杆。pointerup、离开画布和 blur 释放扳机。

`reset()` 清射击和待锁定事件，但保留最近鼠标坐标，恢复菜单后仍可沿原指针瞄准。`consumeLock()` 的 undefined 与 null/具体位置有不同语义，最后由 app 映射成目标 ID。

### 2.3 触屏与快速点击

[touch.ts](../../src/input/touch.ts) 为左右摇杆分别捕获 pointerId，地雷和技能按钮也有独立捕获，允许同时移动、瞄准和按技能。摇杆位移按半径归一并设死区，表现的 thumb 位移不直接写世界坐标。

动作有 held 与 pending 两套状态：手指快速点下抬起即使发生在两个逻辑 tick 之间，也由 pending 保留到下一次 read。菜单、失焦、旋转屏幕、取消捕获时清 held/pending，避免“幽灵输入”。

`update(snapshot,paused)` 读取本机技能槽和冷却，在按钮中更新技能名、可用状态及圆环 CSS 变量。手机是否显示由 CSS 媒体条件和 touch-forced 类决定，核心不读取屏幕尺寸。

### 2.4 单人和联网的意图合成

单人在 `game.playerIntent`，网络使用 [readIntent.ts](../../src/app/readIntent.ts) `readDuelIntent`。网络函数从 viewer 优先的 Snapshot 找本机角色，再调用 Renderer.viewToWorld；本机倒地立即返回显式 fire=false 的空输入。

自动设置只影响合成方式。结构清洗 `cleanIntent` 限制方向为 [-1,1] 并按向量长度归一、过滤技能槽、保留锁定请求的三态，不接受客机上报角色坐标或 HP。**结构清洗与拥有卡片的能力授权不是同一层检查**，见第 12 节的合作输入边界。

## 3. Canvas 渲染与相机

接口：[renderer.ts](../../src/render/canvas2d/renderer.ts) 的 `Renderer.draw / viewToWorld / dispose`；输入视图：[snapshot.ts](../../src/core/snapshot.ts)。Renderer 只读 Snapshot，不调用伤害、购卡或刷怪系统。

### 3.1 三种坐标

| 坐标 | 用途 | 转换 |
|---|---|---|
| 世界坐标 | 移动、碰撞、命中、地图 | 逻辑坐标，和 DOM 尺寸独立 |
| CSS viewport/画布坐标 | PointerEvent 与页面布局 | 减 canvas.getBoundingClientRect 偏移 |
| Canvas backing pixels | 高 DPI 清晰度 | resize 按 devicePixelRatio 放大，最多 2 倍，再设置绘制变换 |

cameraFor 根据角色位置、vision、屏幕纵横比计算可见世界范围；场地比视野小时居中，普通桌面边缘夹取，竖屏额外让飞船保持在控件上方。viewToWorld 可以接收当前逻辑 tick 的 CameraFocus，避免旧 camera 导致鼠标固定时瞄准抖动。

合作时 Snapshot 把本机角色放第一；本机死亡后镜头找仍活着的友军。HUD 仍能读本机 Actor/钱包。Renderer 没有客户端运动预测或快照插值，客机人物位置随收到的权威世界更新。

### 3.2 一帧绘制顺序

1. 填背景、保存上下文，切换世界坐标缩放和平移。
2. 地板/网格、墙、出口、盘丝洞底纹。
3. 下一波出生点预警。
4. 地雷范围、雷体、多段数量、长引信倒计时。
5. 实体弹头与拖尾、EnergyTrace 电弧/激光。
6. 资源外形/面值与击杀归属标签。
7. 存活 Actor、武器/瞄准/技能环、锁定或受伤标记。
8. 短期效果与飘字。
9. 恢复屏幕坐标，再画暗角、HUD、小地图、测试读数和目标数据卡。

`weaponPalette(team,type,remaining,power)` 在 [weaponPalette.ts](../../src/render/canvas2d/weaponPalette.ts) 统一生成弹丸、武器和轨迹颜色：剩余射程映射能量/亮度，伤害用对数压缩影响色相，阵营与物理/电/热决定基色。逻辑层只给比例/伤害，具体发光半径、波折纹理等在 renderer。

电弧视觉使用确定的正弦扰动制造锯齿，激光画连续亮芯；它们都只是已结算攻击的短 TTL 轨迹。渲染帧率变化不会额外产生一次激光伤害。

## 4. DOM 页面、菜单与可见状态

### 4.1 页面装配

| 页面/组件 | 实现 | 主要输入与回调 |
|---|---|---|
| 主菜单、设置、存档、预设、帮助入口 | [homeMenu.ts](../../src/ui/homeMenu.ts) | getState + onDungeon/onEndless/onPractice/onDuel/onCoop |
| 通用局内菜单 | [menu.ts](../../src/ui/menu.ts) | MenuState + MenuHandlers；按可用模式显示页签 |
| 卡片浏览 | [sections/cards.ts](../../src/ui/sections/cards.ts) | CardState、收藏、购买/出售/预购 |
| 属性/主动技能/设置/按键 | [sections](../../src/ui/sections/) 中对应模块 | 从状态生成 DOM，回调改变应用/核心 |
| 结算 | [resultPanel.ts](../../src/ui/resultPanel.ts) | RunSummary、重开/返回主页 |
| 对战大厅与面板 | [serverSession.ts](../../src/app/serverSession.ts) | 服务器统一大厅、RoomInfo、当前身份与角色、网络提示 |
| 服务器大厅 | [serverSession.ts](../../src/app/serverSession.ts) | DOM、WS连接、身份、管理与显示循环；权威模拟在Node服务器 |
| 边缘购买 | [quickBuy.ts](../../src/ui/quickBuy.ts) | 当前会话 active、卡片/提示和购买回调 |

菜单创建一次，open 切页/显示，close 隐藏，dispose 删除自己的 overlay。refresh 只在显示时重建内容并保留 scrollTop；表单聚焦期间合作刷新会尽量避免打断输入。DOM 重建不是 React 的虚拟树 diff。

### 4.2 卡片分类、筛选与收藏

分类是 Card.category，显示顺序在 sections/cards.ts；武器与专精独立分类，收藏作为额外分组出现，同一张收藏卡可同时出现在收藏与原分类。分类使用原生 details/summary；展开状态存在菜单的 Set 中，不作为存档构筑的一部分。

筛选值存 sessionStorage 的 `prism.cardFilter`，有全部/可购买/收藏/已购/未购。价格独立放卡片头部，优先级与用途来自 CardState。availability 只负责展示/按钮约束，真正购买仍由 core/progress 再校验，不能把禁购安全性建立在一个 DOM disabled 上。

页内帮助描述当前规则；版本变化存于 [content/changelog.ts](../../src/content/changelog.ts)，由独立 [sections/changelog.ts](../../src/ui/sections/changelog.ts) 渲染，不依赖联网获取日志。

### 4.3 hidden 与 CSS

面板采用 hidden 属性配合 CSS；作者样式中的 display:grid/flex 可能盖过浏览器默认 `[hidden]`。合作页显式有 `.coop-lobby [hidden] {display:none!important}`，主菜单也有相应 hidden 规则。新增页面隐藏逻辑时应同时检查样式，否则逻辑认为已经隐藏、屏幕却还看得到可编辑旧配置。

## 5. 声音：由视图差分驱动的程序合成

[audio/audio.ts](../../src/audio/audio.ts) 创建 AudioContext、音乐/效果两个 Gain 总线和 DynamicsCompressor；第一次用户交互才 unlock/resume，失败不阻止游戏。没有外部音频文件，因此单文件离线版也可发声。

`notify(sound)` 用振荡器、音量包络、频率滑动与带通噪声合成声音：实体枪使用短冲击加噪声；电弧连续嘶声；激光使用高频下扫与气流。短间隔开火有声音节流，避免每粒霰弹都叠出极高音量。

`update(snapshot,paused)` 比较新旧弹丸 ID、雷 ID、效果键、能量轨迹键与本机总血盾，发现新事件才发声。效果键组合位置/类型和 tick+ttl，避免每一渲染帧重复播放；显式购卡/出售回调也能 notify。世界 tick 回退会清理部分历史比较状态。

音乐通过每 100ms 的 scheduler 向前约 0.2 秒预排音符，采用 88 BPM 的低音/琶音循环。音频 currentTime 与模拟 tick 不同；document.hidden 时暂停音频，恢复时重新定位下一拍。音频噪声可使用 Math.random，因为不改变 World/RNG。

这种差分机制简单但不是完整的游戏事件总线：如果两个权威快照之间某个短事件产生又消失，客机未必观察到。未来要求每次爆炸/技能都可靠播声时，应增加有编号的事件传递，不能仅提高 Canvas 帧率。

## 6. 有序预设、预购与边缘购买

实现：[upgradePlans.ts](../../src/app/upgradePlans.ts)、[planManager.ts](../../src/app/planManager.ts)、[purchaseQueue.ts](../../src/app/purchaseQueue.ts)。

### 6.1 文件、计划和提示的分工

| 结构 | 字段/作用 | 生命周期 |
|---|---|---|
| `BuildPreset` | format=prism-build、version=2、name、targets、favorites、quickMode | 可命名保存和导出，属于用户偏好/方案 |
| `UpgradeTarget` | `{id,level}`，表示该步骤要达到该卡多少级 | 有序里程碑，不是免费送卡 |
| `PurchasePlan` | targets、enabled、quickMode? | 当前对局计划，可随存档保存 |
| `PurchaseNotice` | id、下一等级、价格、remainingTicks、auto | 运行中临时提示，不是已付款记录 |
| `createPurchaseQueue` 闭包 | signature、elapsed | 180 tick 的自动购买计时，通常不写普通存档 |

例如“伤害→射程→攻速→伤害”会变成 damage Lv1、range Lv1、firerate Lv1、damage Lv2。validateTargets 保证同一 ID 在列表中里程碑递增、卡片存在、等级/价格可表示、最终构筑有限；它不保证无需按计划购买前置就能立刻完成。

moveTarget 交换步骤时保留同卡等级的递增集合；removeTarget 撤回某一步时同步降低后面同卡目标等级，避免删掉第一次伤害后，后面一项反而偷偷补买两级。

### 6.2 提示与自动购买

队列先跳过已达成目标，找到下一项；缺钱/缺前置时等待，不任意跳到后面的便宜卡。当前模式为 favorites 时不产生计划提示。可购目标的 ID、等级、价格或 enabled 变化会重置提示计时；自动模式累计到 180 tick 才调用 buy。

`update` 的第 5 个参数叫 **retainTargets**：true 表示在对战等场景保留已完成里程碑，供下一回合复用；它不是“提示可见”或“暂停购买”开关。隐藏提示时正确的调用方式是停止 update 并 reset，1v1 有这个显式分支。合作的参数误用见第 12 节。

全局 PlanManager 通过 `PlanSession` 适配器操作单人 Game、DuelSession 或 CoopSession，不复制三套预设文件编辑器。预设持久化优先读 `prism.builds.v2`、兼容 v1；旧五格 quickSlots 转换成 favorites，旧卡 ID 通过迁移映射。

## 7. 存储分区与格式版本

不要把设置、键位、预设、普通进度、合作进度混成一个 JSON。

| 内容 | 浏览器 key / 格式 | 当前版本 | 实现 |
|---|---|---|---|
| 操作/声音偏好 | `prism.config`，`{version,settings}` | config 3，读 1/2/3 | [storage/config.ts](../../src/storage/config.ts) |
| 键位 | `prism.bindings` | 固定 9 项映射 | [input/bindings.ts](../../src/input/bindings.ts) |
| 商店筛选 | sessionStorage `prism.cardFilter` | 字符串枚举 | sections/cards.ts |
| 收藏与命名预设集合 | `prism.builds.v2`，兼容 v1 | 导出 prism-build v2，导入支持 v1/v2 | planManager.ts、upgradePlans.ts |
| 单人自动/手动槽 | `prism.save.v1.auto / slot-1 / slot-2 / slot-3` | prism-save v1；balanceVersion 7 | saveStore.ts、checkpoints.ts |
| 合作服务端存档 | `.prism-server/server.json` 与导出JSON | prism-coop-save v1；balanceVersion 7；附带身份绑定 | server/store.ts、server/rooms.ts、modes/coop.ts |
| 实时对战 | 不提供比赛进度槽 | prism-server-1；仅进程内支持重连 | serverSession.ts、serverProtocol.ts、server/rooms.ts |

配置版本、存档封套版本、数值版本和联机协议版本互不等同。增加一个新属性、改旧卡公式、换传输协议，可能需要更新不同的版本/迁移入口。

SettingsStore 接受注入的 ConfigStorage，localStorage 访问/JSON/写入出错时回退默认或返回 false。v1 自动操作默认迁为手动，避免旧免费自动操作变成新局白送功能。键位与预设各有自己的容错策略；不是所有存储都由 SettingsStore 管理。

## 8. WorldData、单人存档与迁移

### 8.1 WorldData 并非 Snapshot

[core/serialization.ts](../../src/core/serialization.ts) 定义：

```ts
type WorldData = Omit<World, 'actors' | 'registry' | 'economy'> & {
  actors: Actor[];
};
```

serializeWorld 将 Map 展成数组，去掉 registry/economy 函数或服务，JSON 深复制。默认清空 traces/effects/floaters；传 cosmetics=true 可保留网络所需的短期表现。实体/模式真正影响未来的字段仍保存，不能为了文件小把 laserTicks、burstRemaining、fuseTicks、RNG 或巢母库存当成特效删除。

restoreWorld 接收外部 registry/economy/attrKeys 重新注入，检查数据之后才重建 Map。它是所有存档/网络共享的结构验证基础，但不会单独证明某个模式的规则一致。

### 8.2 分层验证

| 层 | 主要检查 |
|---|---|
| 字节/字符边界 | 单人文件 2 MiB，预设文本 128×1024 字符；网络有独立限制 |
| safeTree | 遍历预算 100000、深度 20，拒绝危险原型键和非有限数字 |
| 几何/属性 | 向量/矩形范围、属性键数量与数值、武器/抗性等域 |
| 实体 | ID 全局不重复、nextEntityId 大于全部已有 ID、数组预算、有效阵营/行为 |
| 状态 | 技能槽、异常计数、波次关系、蜘蛛与巢母状态归属 |
| 购买 | 卡片 ID、等级、价格、支付列表有界 |
| 模式封套 | 种子、房间索引、存活、参与者结构、模式 checkpoint |
| 构筑一致性 | 由所选版本的规则重算 attrs，与存档角色字段核对 |

这是手写校验器，不是使用 JSON Schema 自动生成的反序列化。大部分已知字段会验证，不能把“严格验证”理解为对所有对象一律拒绝每个未知额外字段；新增字段仍应显式设计验证规则。

### 8.3 RunCheckpoint 与恢复流程

[app/checkpoints.ts](../../src/app/checkpoints.ts) 的 RunCheckpoint 封套包含：format/version、balanceVersion、name/savedAt、mode、initialSeed、restarts、roomIndex、world，以及可选 difficulty/endless/plan。

```mermaid
flowchart TD
  File["JSON / 存储槽"] --> Envelope["readCheckpoint：格式、大小与模式"]
  Envelope --> Registry["选择冻结历史卡表"]
  Registry --> World["restoreWorld：结构验证"]
  World --> Build["核对旧构筑 → 迁移并重算"]
  Build --> Restore["launch：World + 模式 checkpoint"]
  Restore --> Menu["暂停菜单，等待继续"]
```

普通存档拒绝 participants/cardRestrictions，防止把联网进度混入单人；已经结束或玩家死亡的进度也拒绝。单人房间上界由 `buildDungeon().length−1` 推导；无尽要求 roomIndex=0、世界种子一致、独立生成状态合法。

### 8.4 为什么不能直接按新卡表重算旧存档

[cardMigrations.ts](../../src/app/cardMigrations.ts) 的顺序是：

1. registryForSave 根据 balanceVersion 选择 V1/V2/V3/V4/V5/V6 或当前 V7。
2. 必要时仅补旧版本新增属性的默认字段；再通过 restoreWorld 结构检查。
3. 使用旧卡表核验“购买记录确实对应旧 attrs”，不把未知属性一律洗成合法。
4. 映射退役 ID，合并等级，按旧价补缺失 paid，保留所有实付金额。
5. 用当前卡表 reapplyAttrs，当前 HP/盾不超过新上限，但不靠迁移免费补满。
6. 保留旧弹丸、地雷、房间和随机状态；它们已有的数值不会统一重发一遍。
7. 迁移收藏与有序未完成目标，不排序丢掉购买顺序。

无 balanceVersion 的历史文件会尝试匹配对应旧规则；未知版本拒绝。数值版本 7 与存档格式 v1 并存，是因为 JSON 外壳没变、卡片解释方式变了。

### 8.5 保存、命名与失败处理

[saveManager.ts](../../src/app/saveManager.ts) 管理业务，SaveStore 只做有界字符串读写。自动保存由进关回调与main的一秒策略检查、页面隐藏/离开及菜单动作请求触发，统一服从每关/定时/关闭策略；Game.checkpoint 在未开始、测试场、已结束时返回 null。

三个手动槽相互独立，导入先完整验证再写入，导入成功也不会立刻替换当前世界，用户还需读档。覆盖/导入保留已有槽位名称，空槽继承文件名字段；名称 1–40 字、禁止控制字符。导出文件名额外移除文件系统特殊字符。

导出使用 Blob/object URL/download 属性，随后撤销 URL，不需要服务器。写入失败不会让游戏停止，但需要保留文件备份；清理浏览器数据会丢本地槽，离线 file:// 与线上域名也不应被视为天然共享同一存储区。

### 8.6 合作存档的额外语义

CoopSave 还保存 config、hostId、started、全部 participants、成员在线/离线/倒地状态、roomPartySize、每人 plans、无尽状态。客户端可导出最后收到的快照，封套 hostId 改为自己的 viewerId。

createCoopMatch(saved) 恢复时：原在线角色先取实际生命；只把 hostId 成员设在线/准备，其余席位 alive=false、HP=0，并保留 offlineHp/offlineAlive 和 reviveTicks。世界暂停，朋友要重新建立连接。**重新建房恢复不是自动选主或无缝迁移**。

合作接受 balanceVersion=5/6 或当前7，逐队员核验旧构筑并迁移，保留缺席席位；不接受合作V1–V4。自动槽也只有合作独立的一槽，没有普通 SaveManager 的三个手动槽；文件备份承担多份合作进度保存。

## 9. 当前网络入口

[app/serverSession.ts](../../src/app/serverSession.ts)统一提供服务器地址、房间列表、合作与1v1、身份备份、管理和个人菜单。浏览器不运行联机World、不接收CoopSave作为实时快照；只提交操作并解码显示差量。

## 10. 当前同步与重连

[net/control.ts](../../src/net/control.ts)清洗输入和购买动作，并累积一次性技能/锁定请求；[net/sync.ts](../../src/net/sync.ts)负责字段字典、差量基线、关键帧、插值与尾迹；[net/serverProtocol.ts](../../src/net/serverProtocol.ts)校验客户端消息、服务器地址与协议版本。

## 11. 服务器、权限与持久化

实现详解见[第五篇](05-server-and-replication.md)，使用步骤见[服务器指南](../server-guide.md)。建房需授权，所有管理操作按身份和当前房间角色检查；合作存档与ID席位绑定由服务器持久化，浏览器身份备份不含服务器管理权。

## 12. 当前边界

- 合作最终房间索引25已接受，个人菜单不推进自动购买，自动瞄准须拥有卡片。
- 浏览器没有通用局域网广播枚举；发现依赖本机或已知服务器入口。真实多播与HTTPS到局域网的权限行为需要目标网络/浏览器测试。
- 服务器模拟、显示差量、压缩与插值已实现；客户端没有位置预测、回滚或延迟补偿。
- 免注册凭证适合私人房间，不等同于公开竞技账号或强实名封禁。1v1回合不跨服务器进程重启恢复。
- 实际容量仍受敌人数、弹幕量、CPU和线路限制，数据量基准与本机多连接集成测试不替代五台设备跨网络验收。

## 13. 测试体系：什么证据能支持什么结论

配置：[vite.config.ts](../../vite.config.ts) 规定 Node 环境与 tests/**/*.test.ts。测试多直接创建 World 或 Mode，注入假输入/时钟，不必启动浏览器。

| 层次 | 代表测试 | 能发现的错误 |
|---|---|---|
| 数学/数值 | attrs、builds、tuning、cardAudit | 减伤顺序、属性优先级、卡片兼容、公式偏离 |
| 几何/命中 | movement、ballistics、rehits | 卡墙、穿墙、漏碰撞、重复或缺失再命中 |
| 复杂机制 | arsenal、weaponVariants、lightningTree、weaver | 电弧分叉、激光脉冲、子雷和 Boss 库存时序 |
| 模式 | dungeon、endless、practice、duel、coop | 种子生成、清场/补刷、回合、分配与复活 |
| 数据边界 | saves、saveNames、priceMigration、plans、framing | 旧文件迁移、实付账目、命名、非法包与分片 |
| 客户端协调 | game、keyboard、pointer、readIntent、config | 重开/暂停、输入去粘连、控制偏好与本机意图 |
| 架构/回放 | core-isolation、determinism | 依赖倒流、同输入状态分歧 |

当前包含 **38 个测试文件、446 项测试**。数量只反映现有覆盖；Node真实WebSocket测试和本机UDP协议测试不能替代五台实机、跨网段发现、手机双指操作、后台节流、音频解锁或多人长局带宽验收。

推荐验证顺序：先跑改动相关单测 → typecheck/lint/build → 必要时完整 suite → 对 UI/网络改动做浏览器行为检查。文档修改还应验证链接、引用符号、流程顺序；只让 tsc 通过不会发现一句错误的技术说明。

## 14. 构建、离线与发布

### 14.1 常用命令

```bash
npm ci                 # 按 package-lock 安装
npm test               # 当前全部 Vitest 单测
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run build          # 类型检查、Vite 生产包、version.json
npm run build:offline  # 类型检查、单文件 HTML 导出
```

`npm run dev` 和 `npm run preview` 是工具提供的本机命令；项目当前约定不由代理继续维护旧本地/旧 Sites 站点。本手册编写和核对没有启动这些服务。

### 14.2 普通网页产物

Vite target ES2022，默认生成 `dist/index.html`、带哈希的 JS/CSS、source map。base 从 VITE_BASE_PATH 注入，GitHub 仓库子路径使用 `/prism/`。

[write-build-info.mjs](../../scripts/write-build-info.mjs) 生成 `dist/version.json`，含 repository、branch、commit_sha、built_at。源码 SHA 优先使用 GITHUB_SHA，再兼容旧 source metadata，最后本地 git rev-parse；如果本地 checkout 的 Git 元信息滞后，不能只看一次本地 build 就声称版本号代表当前远程提交。

### 14.3 单文件导出

[build-offline.mjs](../../scripts/build-offline.mjs) 使用 Vite 独立 lib 配置，把同一 app/main.ts 打成单个 IIFE：内联动态 import、CSS 不拆分、关闭模块预加载和 sourcemap；验证只有一块脚本与样式、没有外部 CSS URL；用 Node vm.Script 做语法检查，然后写 `dist-offline/PRISM_offline.html`。

HTML 内有代码、样式和程序合成音频，可直接打开单人游戏。代码自包含不代表联机不需要网络/浏览器许可；连接仍需HTTP/WS服务器，存储和下载在file://下也受浏览器实现影响。GitHub Pages workflow调用server:package发布游戏和服务器ZIP，不自动发布离线HTML。

### 14.4 GitHub 是当前交付路径

流程在 [.github/workflows/deploy-pages.yml](../../.github/workflows/deploy-pages.yml)：main push/workflow_dispatch → checkout → Node 22 → npm ci → npm test → `VITE_BASE_PATH=/prism/ npm run build` → 上传 dist → Pages deploy。构建和部署分 job，部署 job 才取得 pages/id-token 权限，同组部署会取消旧进行中任务。

workflow **没有单独运行 lint**，所以 lint 仍应在提交前执行。GitHub 静态站点不托管比赛模拟服务器；上线的 JS 在各玩家浏览器运行，房主承担多人模拟。

项目约定详见 [AGENTS.md](../../AGENTS.md)、[deployment.md](../deployment.md)：远端 what20360/prism main 为正式源，交付前检查 head，避免覆盖别人更新；旧 Site 身份元数据保留，不重新维护或部署旧 Site。

## 15. 扩展与排错路径

### 15.1 常见新增功能涉及哪些文件

| 改动 | 最小设计链 | 易漏的配套 |
|---|---|---|
| 新增纯属性卡 | content/cards + purpose + profile | 价格/说明同源、优先级、sale/reapply、副作用条件 |
| 新增 AttrSet 字段 | core/attrs + 玩家/怪物基线 | 序列化键、旧版默认迁移、网络构筑核验、Snapshot/测试 |
| 新增武器机制 | weapon 编码/属性、weapons 分派、独立算法 | Card 依赖/互斥、输入范围、持续状态、配色音效、存档/协议版本 |
| 新增敌人行为 | EnemyBehavior、AI 分派、必要状态 | enemies/traits、生成器、序列化允许列表、命中/死亡、外观与测试 |
| 新增关卡集 | LevelSet.room + RoomDesign | spawn 安全、可达性、Boss 活动区、无尽跳层出口 |
| 新增设置 | ControlSettings/默认/解码/保存、UI | 正常客户端和联机输入合成、旧配置迁移 |
| 改自动购买 | PurchasePlan/Queue、各模式推进点 | 同时检查单人、1v1、合作与菜单/暂停条件 |
| 新增多人动作 | action 联合类型、cleanAction、模式授权 | 连接席位、序号/阶段、客户端确认与失败反馈 |
| 改存档结构/卡片语义 | WorldData/Checkpoint、迁移规则 | 旧文件先校验、冻结旧表、保留实付价和随机状态 |

### 15.2 从症状反查

- **射击方向不对**：先看 Intent 是否为自动/手动，再查 viewerId、当前镜头换算、lockTargetId 和 resolveAimAngle。
- **连发/激光停不下来**：查 automaticFire+fire=false、burstRemaining/laserTicks、卖卡/换武器重算、网络旧输入是否过期。
- **伤害不符**：查发射时属性快照 → 核心倍率 → block/armor/resist → 当前盾 → iframes → 模式经济分支，不从飘字颜色推断伤害规则。
- **没有刷怪/不开门**：查 room.phase、入口激活距离、pendingSpawns、活敌人、waves.remaining/countdown，再查 app 的切房时机。
- **怪物卡墙**：查实际圆半径与墙角间距、navPath 第一/后续航点、navTimer、目标移动是否触发重算。
- **读档失败**：从封套/大小 → balanceVersion → WorldData 结构 → 构筑匹配 → 模式额外约束逐层定位，先保留原文件。
- **联机一连就断**：区分HTTP连接、浏览器局域网权限、WS来源拒绝、身份凭证与协议解码失败；检查服务器终端、/health、版本、地址、房间代次和消息预算。
- **本地检查通过但线上旧版**：看 Actions 的测试/构建/部署结论与线上 version.json，不仅比较页面视觉。

## 16. 阅读索引与维护约定

要跟一条完整调用链，推荐以下顺序：

1. **启动和一帧**：main.ts → game.ts → simulation.ts → snapshot.ts → renderer.ts。
2. **买卡后射击**：ui/sections/cards.ts → core/progress.ts → core/cards.ts → content/cards.ts → systems/weapons.ts → projectiles/hits.ts → damage.ts。
3. **存档恢复**：saveManager.ts → checkpoints.ts → serialization.ts → cardMigrations.ts → main.launch → game 构造。
4. **合作输入**：serverSession输入 → decodeClient/cleanIntent → 凭证绑定席位 → tickRoom/CoopMatch.tick → step → playState/差量编码 → 客户端解码/插值。
5. **无尽新层**：createEndlessMode.afterStep → advance/enter → pickLevelSet/rollEndlessEnemy → applyRoom → updateRoomEntry。

技术说明应写清基线、真实调用层级、数据拥有者和重要边界。改字段时同步创建/校验/迁移/显示/测试；改行为时以需求和数值文档确认意图，再更新技术手册。代码和帮助/历史说明冲突时，不应通过复制旧说明制造第二个“事实来源”。

## 17. 主要符号的源码声明位置

下面的行号按本手册代码基线生成，点击可跳到声明。未来增删代码后行号可能漂移；符号名仍是检索依据。

| 符号 | 源码声明 |
|---|---|
| `createKeyboardInput` | [src/input/keyboard.ts:16](../../src/input/keyboard.ts#L16) |
| `createTouchControls` | [src/input/touch.ts:15](../../src/input/touch.ts#L15) |
| `createCanvasRenderer` | [src/render/canvas2d/renderer.ts:20](../../src/render/canvas2d/renderer.ts#L20) |
| `createAudioEngine` | [src/audio/audio.ts:7](../../src/audio/audio.ts#L7) |
| `validateTargets` | [src/app/upgradePlans.ts:11](../../src/app/upgradePlans.ts#L11) |
| `createPurchaseQueue` | [src/app/purchaseQueue.ts:6](../../src/app/purchaseQueue.ts#L6) |
| `createPlanManager` | [src/app/planManager.ts:16](../../src/app/planManager.ts#L16) |
| `createSaveManager` | [src/app/saveManager.ts:6](../../src/app/saveManager.ts#L6) |
| `serializeWorld` | [src/core/serialization.ts:55](../../src/core/serialization.ts#L55) |
| `restoreWorld` | [src/core/serialization.ts:60](../../src/core/serialization.ts#L60) |
| `readCheckpoint` | [src/app/checkpoints.ts:21](../../src/app/checkpoints.ts#L21) |
| `migrateWorldBuild` | [src/app/cardMigrations.ts:64](../../src/app/cardMigrations.ts#L64) |
| `readCoopSave` | [src/app/modes/coop.ts:34](../../src/app/modes/coop.ts#L34) |

上一篇：[战斗、内容与模式](02-combat-content-and-modes.md)；总入口：[架构、数据结构与模拟](01-architecture-and-simulation.md)。
