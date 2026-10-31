# PRISM 架构设计

| 项目 | 内容 |
|---|---|
| 版本 | v1.21 |
| 状态 | M1–M4 已实现，主菜单、测试场与无尽模式已接入 |
| 依赖 | 玩法与规则见 [requirements.md](./requirements.md)，数值见 [balance.md](./balance.md) |
| 技术选型依据 | [adr/0001-tech-stack.md](./adr/0001-tech-stack.md) |

> 本文只描述**怎么实现**。玩法争议回到 requirements.md，数值争议回到 balance.md。

---

## 1. 设计目标与约束

| # | 目标 | 可检验的判据 |
|---|---|---|
| 1 | 逻辑与表现分离 | `core/` 在 Node 里无 DOM 也能跑完整一局 |
| 2 | 模块可替换 | 换渲染器/输入/网络/存储时不改 `core/` |
| 3 | 确定性 | 同种子 + 同输入序列 → 同状态哈希 |
| 4 | 内容数据化 | 加敌人/武器/卡片/关卡不改 `core/` 逻辑 |
| 5 | 零运行时依赖 | 产物不引入第三方运行时库 |
| 6 | 可测试 | 核心规则可纯函数式单测，无需启动浏览器 |

**术语**

| 术语 | 含义 |
|---|---|
| `World` | 一局游戏的全部可变状态（纯数据） |
| `Intent` | 控制器输出的「意图」，不是状态修改 |
| `Tick` | 一次固定步长推进（1/60 秒） |
| `Snapshot` | 供渲染与 UI 读取的只读视图 |
| `Card` | 升级卡片：`priceFn` + `effectFn` + `priority` |

---

## 2. 分层总览

```
┌───────────────────────────── 外层（可替换） ─────────────────────────────┐
│  app/      启动、场景切换、模式装配、把各层接起来                          │
│  ui/       升级面板、HUD、结算面板（DOM，只读 Snapshot）                   │
│  render/   Canvas2D 绘制（只读 Snapshot）                                  │
│  input/    键盘 / 手柄 / 触屏 / 回放 → Intent                              │
│  net/      传输接口（首发空实现）                                          │
│  storage/  本地配置持久化                                                  │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ 只向内依赖
┌───────────────────────────────────▼───────────────────────────────────────┐
│  core/     纯逻辑：World、Systems、Simulation（无 DOM、无 IO、确定性）      │
└───────────────────────────────────▲───────────────────────────────────────┘
                                    │ 注入数据与纯函数
                          ┌─────────┴─────────┐
                          │  content/         │  敌人、武器、卡片、房间模板
                          └───────────────────┘
```

**方向铁律**：`core/` 不 import 任何外层，也不 import `content/` 的具体实现——
`content` 由 `app/` 组装后**注入**给 `core`（见 5.2）。这样换一套内容不需要动 `core`。

---

## 3. 依赖规则与强制手段

```
app    → ui / render / input / net / storage / core / content
ui     → core(types, snapshot)
render → core(types, snapshot)
input  → core(types)
net    → core(types)
storage→ (无 core 依赖)
content→ core(types)          # 只依赖类型，不依赖实现
core   → core                # 只依赖自身
```

**ESLint 约束（示意）**

```js
// eslint.config.js
{
  files: ['src/core/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['**/app/**', '**/ui/**', '**/render/**', '**/input/**', '**/net/**', '**/storage/**'],
          message: 'core 不得依赖外层模块' },
        { group: ['**/content/**'],
          message: 'core 只能接收注入的内容，不能直接 import 具体内容' },
      ],
    }],
  },
}
```

**兜底测试** `tests/core-isolation.test.ts`：扫描 `src/core` 下所有 `import` 语句，命中即失败。

---

## 4. 目录结构

```
src/
  core/
    types.ts            基础类型：Vec2、EntityId、Team、DamageSource
    world.ts            World 结构与工厂（创建一局）
    simulation.ts       step(world, intents): 固定步长推进
    rng.ts              mulberry32 可播种 PRNG
    attrs.ts            AttrSet 定义、默认值、卡片管线解析
    cards.ts            Card 接口、注册表、购买/前置校验
    actor.ts            Actor：生命、护甲、护盾、属性、武器槽
    controller.ts       Controller 接口、意图结构
    systems/
      movement.ts       移动与边界/墙体碰撞
      weapons.ts        开火计时、发射器调度、瞄准策略调用
      projectiles.ts    子弹推进、射程、穿透计数、墙体命中
      mines.ts          放置、触发倒计时、减速场、爆炸清弹
      damage.ts         伤害管线（穿透→护甲→无敌帧→护盾→生命）
      rewards.ts        棱晶/得分结算（输出收益 + 受伤收益）
      spawn.ts          房间敌人生成
      room.ts           房间状态机与清场判定
      timers.ts         连杀超时、冷却、无敌帧计时
    snapshot.ts         World → Snapshot（只读视图，供 render/ui）
  content/
    enemies.ts          敌人原型与数值
    weapons.ts          武器与子弹参数
    cards.ts            升级卡片（价格函数 + 机制函数）
    rooms.ts            房间模板（含墙体布局）
    floors.ts           层的构成
    validate.ts         运行时校验器（手写，~100 行）
  render/
    canvas2d/           渲染器实现（可整体替换）
    theme.ts            几何风格：颜色、描边、发光
  input/
    keyboard.ts  gamepad.ts  touch.ts  replay.ts
    intent.ts           设备无关的意图输出
  ui/
    menu.ts             暂停菜单外壳（Esc，左侧目录 + 右侧内容）
    sections/           菜单分页：help / keys / cards / attrs
    cardInfo.ts         属性与前置的中文文案格式化
    resultPanel.ts      结算面板
    homeMenu.ts         主菜单与继续本局入口
  net/
    transport.ts        接口定义（首发空实现）
  storage/
    config.ts           版本化设置读写与迁移
  app/
    main.ts             入口
    game.ts             场景与模式装配
    modes/
      dungeon.ts        普通模式
      practice.ts       测试场配置、重置与伤害统计
tests/
  unit/                 规则单测
  replay/               确定性回放回归
  fixtures/             内容与种子样本
```

---

## 5. `core/` 内部设计

### 5.1 世界状态（纯数据）

```ts
interface World {
  tick: number;                 // 已推进的 tick 数
  rng: RngState;                // 可播种、可序列化
  seed: number;
  room: RoomState;              // idle | entered | combat | cleared | exited
  actors: Map<EntityId, Actor>;
  projectiles: Projectile[];
  mines: Mine[];
  effects: Effect[];            // 短生命周期表现事件（由 render 消费）
  shards: number;
  score: number;
  stats: RunStats;              // 核心命中、最高连杀、用时等
  spawnOrder: EntityId[];       // 固定顺序，保证确定性遍历
}
```

- **不用 ECS 框架**：实体种类只有 3~4 类，`Map` + 数组足够，省掉一层抽象与 GC 压力。
- 所有容器遍历使用**稳定顺序**（插入顺序或显式排序），禁止依赖 `Object.keys` 的隐式顺序做数值计算。

### 5.2 属性与卡片管线

```ts
interface AttrSet {
  maxHp: number; speed: number; radius: number; coreRadiusMult: number;
  armor: number; shield: number; shieldCapMult: number; shieldRegen: number;
  damage: number; fireRate: number; bulletSpeed: number; range: number;
  pierce: number; bulletSize: number; blastRadius: number; penetration: number;
  multishot: number; lifesteal: number; shieldSteal: number;
  innerDamageMult: number; revives: number; chainCap: number; shardGain: number;
  deflectLevel: number; deflectWindowSeconds: number;
  deflectCooldownSeconds: number; reflectDamageMult: number;
}
```

解析（每次购买后重算，**不在每 tick 重算**）：

```ts
function resolveAttrs(base: AttrSet, purchased: Purchase[], cards: CardRegistry): AttrSet {
  const ordered = [...purchased].sort((a, b) => {
    const pa = cards.get(a.id).priority, pb = cards.get(b.id).priority;
    return pa - pb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);   // 稳定顺序
  });
  return ordered.reduce((acc, p) => cards.get(p.id).effectFn(p.level, acc), { ...base });
}
```

- `effectFn` 必须是纯函数（无 `Math.random`、无 `Date.now`、不改入参）。
- 卡片注册表由 `app/` 注入，`core` 只认接口。
- 派生值不缓存进 `AttrSet`（例如减伤由 `armor` 现场换算），避免两份真相。

### 5.3 控制器与意图

```ts
interface Intent {
  move: Vec2;              // 归一化方向
  aim?: Vec2;              // 手动瞄准方向；缺省时自动索敌
  fire?: boolean;          // false 表示本 tick 不开火；缺省表示火力全开
  switchWeapon?: boolean;
  placeMine?: boolean;
  skill?: 0 | 1;
  openPanel?: boolean;
}

interface Controller { next(world: World, self: EntityId): Intent }
```

- `PlayerController`：读 `input/` 归一化后的输入。
- `AIController`：与玩家产出**同构意图**，因此类玩家敌人零额外战斗代码。
- 回放控制器：直接吐录制好的意图序列。
- **意图不修改世界**，由 `simulation` 统一应用。
- `aim` / `fire` 让「瞄准 × 射击」的四种自动/手动组合全部落在 `app/` 层，`core/` 不需要知道哪个模式在生效；省略 `aim` 时 `systems/weapons` 自动索敌，所以 AI 与「自动瞄准」走同一条代码路径。

### 5.4 固定步长 tick 流程（顺序即规则）

`step(world, intents)` 每个 tick 严格按此顺序执行，顺序变化会改变结果：

| # | 阶段 | 说明 |
|---|---|---|
| 1 | 采集意图 | 所有 actor 的 controller 产出 Intent |
| 2 | 应用意图 | 移动向量、切枪、放雷、技能、面板开关 |
| 3 | 计时器 | 冷却、无敌帧、连杀超时、地雷倒计时、飘字与受击高亮递减 |
| 3.5 | 房间入场 | 玩家离开入口 `ROOM_ACTIVATION_RADIUS` 后生成 `pendingSpawns` 并进入 `combat` |
| 4 | 移动 | 位置积分 + 墙体/边界碰撞 |
| 5 | 开火 | 射速计时到点则生成子弹（`Intent.aim` 优先，否则瞄准最近敌人） |
| 5.5 | 偏转力场 | 场内敌方子弹按 `(1-d/R)²` 获得背离推力（主动窗口 ×5） |
| 6 | 投射物 | 子弹推进、射程判定、墙体命中、穿透计数 |
| 7 | 命中结算 | 子弹 × 单位 / 子弹 × 地雷本体 → 产生 `DamageEvent` |
| 8 | 地雷 | 触发判定、减速场应用、爆炸与区域清弹 |
| 9 | 伤害管线 | 按 5.5 顺序结算 `DamageEvent` |
| 10 | 收益 | 输出收益与受伤收益累加，更新连杀 |
| 11 | 状态推进 | 死亡判定、房间清场与出口判定、Boss 阶段；出口被玩家踩中后由 app 切到下一房间 |

- 阶段 7 产生的伤害**当 tick 结算**，不延迟到下一帧。
- 阶段 8 的清弹在阶段 7 之后，保证「本 tick 命中的子弹已经结算过」。

### 5.5 伤害管线（唯一入口）

任何伤害都必须经过同一个函数：

```
damage(target, rawDamage, source)
  1. 偏转判定（若 target 处于偏转窗口且 bullet 可偏转）
  2. 有效护甲 = max(0, target.armor - source.penetration)
     减伤 = 有效护甲 / (100 + 有效护甲)
     actual = max(0, rawDamage × (1 - 减伤))
  3. 无敌帧：若 target 处于 iframes → actual 记为 0（但「伤害事件」仍然成立）
  4. 护盾吸收：shield -= min(shield, actual)
  5. 生命扣除：hp -= 剩余 actual
  6. 受伤收益：rawDamage × takenRate（仅敌方来源；见 requirements 5.2.2）
  7. 输出收益：actual × tierRate × chain（仅玩家来源）
  8. 触发事件：hit / coreHit / kill / shieldBreak
```

- 第 3 步「事件仍成立」很关键：无敌帧不计伤害，但**不计受伤收益**（见 requirements 5.2.2 的边界）。
- 收益在管线内部累加，避免各系统各自计算导致口径不一致。

### 5.6 确定性规则

| 规则 | 做法 |
|---|---|
| 时间 | 只推进 `tick`，禁止 `performance.now()` 参与逻辑 |
| 随机 | 全部走 `rng.ts`（mulberry32），种子入 `World` |
| 遍历 | 所有容器固定顺序；新增实体按自增 `EntityId` 追加 |
| 浮点 | 统一使用 `number`，不做跨平台数值比较；状态哈希用定点化（乘以 1e6 取整） |
| 快照 | 只读拷贝，渲染层无法写回 |
| 回放 | 录制 `seed + intent[]`，重放时逐 tick 比对状态哈希 |

**什么算「状态」**：`hashWorld` 只覆盖会影响后续模拟的字段（tick、RNG、棱晶、分数、actor 的 id/位置/生命）。
纯表现层数据——`effects`、`floaters`（飘字）、`damageFlashTicks`（受击高亮）——**故意不参与哈希**，
否则「换个数字飘字样式」就会让回放回归红掉。

### 5.7 命中判定的两个陷阱（M2 实测发现）

1. **枪口偏移不能大于目标半径**
   首版把子弹生成在 `actor.radius + bulletSize` 处。贴脸时敌人中心比枪口还近，子弹直接生成在敌人身后，
   结果「近身永远打不中」。修复：枪口偏移固定为 `actor.radius * 0.5`。

2. **内层不能用「当前点」判定**
   子弹在外层就被拦下，因此它永远到不了内层——逐帧点判定会让内层打不中任何东西。
   修复：命中时用「本 tick 的飞行射线」判断是否穿过内层，且要求 `pierceLeft ≥ 2` 才结算内层（消耗 2 层穿透），
   否则只结算外层（消耗 1 层）。这与 requirements 5.6.1 的「穿透层数」规则一致。

> 这两条都是**离散步进**带来的系统性问题，不是随手写错；任何基于逐帧位置判定的命中系统都会遇到。

---

## 6. 快照与渲染契约

```ts
interface Snapshot {
  tick: number;
  room: RoomState;
  player: ActorView;
  actors: ActorView[];
  projectiles: ProjectileView[];
  mines: MineView[];
  fx: FxView[];          // 由 effects 派生，供表现层消费
  hud: { hp: number; shield: number; shards: number; chain: number };
}
```

- `render/` 与 `ui/` **只读**快照；任何交互（加点、切枪）都通过 `app/` 转成意图或命令。
- 快照每 tick 生成一次；渲染可插值，但**不修改**快照。
- UI 面板（升级、结算）是 DOM 层，打开时 `app/` 暂停 tick 推进（普通/无尽模式）。

**渲染契约**：几何体只用基础图元（圆、矩形、多边形、线段），禁止依赖外部图片。
地雷的爆炸半径与减速场必须始终可见（requirements 5.6.2）。

---

## 7. 扩展点

| 想加什么 | 需要动哪里 | 不需要动哪里 |
|---|---|---|
| 新武器（激光/近战） | `content/weapons.ts` + 一个新的发射器行为 | `core/systems/weapons.ts` 的调度骨架 |
| 新敌人 | `content/enemies.ts` + 行为标记（已有原型） | 战斗与伤害管线 |
| 新卡片 | `content/cards.ts` | `core` 任何文件 |
| 新模式（无尽/PvP/RTS） | `app/modes/*` + 内容数据 | `core` 的既有规则 |
| 新渲染器 | `render/` 新实现 | `core` |
| 联网 | `net/` 实现 + 意图同步 | `core`（已确定性） |
| 新瞄准策略 | `core/systems/weapons.ts` 的策略表 | 其他系统 |

**验收口径**：M5 接入「无尽模式」时，`src/core/` 应零改动。

---

## 8. 不变量与错误处理

**设置与生命周期的当前落点**：`storage/config.ts` 定义当前操作设置及版本化存档，`app/main.ts` 负责加载并订阅保存；`createGame` 只接收初始设置与变更回调，不直接访问存储。`prism.config` v2 保存 `aimMode` / `fireMode` / `music` / `sfx` / `touchControls`，v1 迁移为手动默认，损坏或不可读时回退默认值。所有重开入口调用 `Game.restart()`，由统一 UI 回调关闭菜单和结算面板，同时重置输入与帧计时。暂停和局末状态不再采集战斗意图。

| 不变量 | 守护方式 |
|---|---|
| `hp ≥ 0`、`shield ≥ 0`、`armor ≥ 0` | 管线内 `clamp`，单测覆盖 |
| 减伤永远 < 1 | 由 `armor/(100+armor)` 数学保证 |
| 同屏子弹 ≤ 400、地雷 ≤ 8/方 | 生成处检查，超限丢弃并记日志 |
| 卡片 `effectFn` 不改入参 | 单测：解析前后旧对象深比较 |
| 内容引用完整 | 启动校验（`content/validate.ts`） |

- 内容校验失败：**启动即崩溃**并输出 `content/x.ts: field` 具体路径（不静默降级）。
- 运行期异常：捕获后冻结本局并展示结算面板，不吞异常。

---

## 9. 性能预算

| 指标 | 目标 |
|---|---|
| 逻辑单帧 | < 4 ms（1920×1080、400 子弹、30 敌人） |
| 渲染单帧 | < 8 ms |
| 内存 | 稳定态 < 100 MB |
| 分配 | tick 内避免大对象分配；`effects` 用池 |

- 碰撞分层：先 AABB 粗筛，再精确判定；子弹-单位用网格分桶（房间尺寸固定，网格 128×128）。
- 不允许在 tick 内做字符串拼接或 `JSON` 序列化。

---

## 10. 测试策略

| 层 | 内容 |
|---|---|
| 单元 | 伤害管线各步骤、护甲换算、卡片解析、收益公式、地雷状态机 |
| 内容 | 校验器：ID 唯一、数值合法、引用存在 |
| 集成 | 脚本化一局（固定种子 + 脚本意图）跑完 5 层，断言结算数值区间 |
| 回归 | **确定性回放**：录制样本 → 重放 → 状态哈希一致 |
| 结构 | `core-isolation` 扫描 import |

CI 顺序：`typecheck → lint → unit → content → replay`。

---

## 11. 需求 → 架构落点

| 需求 | 落点 |
|---|---|
| 5.2 收益公式（输出/受伤） | `systems/rewards.ts` + `systems/damage.ts` 第 6/7 步 |
| 5.3 卡片制 | `core/cards.ts` + `core/attrs.ts` + `content/cards.ts` |
| 5.6.2/5.6.3 地雷 | `systems/mines.ts` + `systems/projectiles.ts` |
| 5.7.2 护甲 | `systems/damage.ts` 第 2 步 |
| 5.7.4 偏转/反射 | `systems/damage.ts` 第 1 步（改归属与方向） |
| 5.8 双层判定 | `systems/projectiles.ts` 命中判定 + `core/actor.ts` 判定层数据 |
| 6.5 房间流程 | `systems/room.ts` + `systems/entry.ts` + `core/dungeon.ts` + `app/modes/dungeon.ts` |
| 9.5 统一 Actor | `core/actor.ts` + `core/controller.ts` |

---

## 12. 待验证假设（M1–M2 期间确认）

1. 不引入 ECS 是否会限制后续 RTS 模式 → M5 验证；若受限，只替换 `core/world` 内部实现。
2. 每 tick 生成完整快照的分配压力 → 若超预算，改增量快照。
3. 卡片 `effectFn` 以函数形式存在于 `content` 是否妨碍热重载 → 先不做热重载。
4. 网格分桶的格子尺寸（128）在墙体密集房间是否合适 → 实测调整。


## v1.7 触控、声音与构筑扩展

- `input/touch.ts` 用独立 pointer capture 合并移动、瞄准、射击、地雷与技能；短触动作排队至下一逻辑 tick，暂停/失焦/转屏清空。设备数据仍在 `app/game.ts` 转成统一 `Intent`。
- 玩家自动瞄准/射击分别由 `AttrSet.autoAim` / `autoFire` 与已保存偏好共同决定；没有卡片时 `app/` 始终提供手动方向与显式开火状态。AI 继续复用缺省自动索敌路径。
- `Purchase.paid` 按级保存实付价格；可回收卡的出售按最后一级账目计算，不受后续价格函数变更影响。出售通过同一属性管线重算，依赖卡阻止撤销。
- 跳弹次数与爆破半径在发射时写入子弹；地雷伤害、范围、冷却、数量与减速从当前属性复制到新地雷。范围伤害仍只走 `applyDamage`，不重复核心加成。
- 快照增加射击/技能/地雷冷却与弹丸速度，渲染器只读这些字段绘制弧环、尾迹和渐隐光束。竖屏相机把玩家保留在触控按钮上方。
- `audio/audio.ts` 消费快照变化和买卖事件，通过 WebAudio 合成音效与音乐；首次用户交互才初始化，页面隐藏暂停，卸载时清理节点与定时器。音频不参与模拟与回放哈希。


## v1.8 锁定、装备与弹丸生命周期

- `Actor.manualLockId` 固定手动目标，`lockTargetId` 为统一选择结果。`systems/targeting.ts` 先应用手动指令，失效时再按攻击方向/可见性选目标；瞄准和追踪读取同一目标。输入层只提交目标编号，不直接修改世界。
- `skillSlots` 只允许两个技能，解锁由永久属性决定。偏转/狂暴/冲刺各自维护冷却，换装取消不再装备的主动效果并保留计时。`combatAttrs` 返回临时加成视图，购买重算不会覆盖或重复叠加技能。
- 敌人使用膨胀墙角的可见图路线与分期重算，直接可见时绕过寻路；移动保留模拟摇杆幅度，分段处理高速位移，碰撞后做有限柔性分离。
- `projectiles` 逐段寻找最近墙体，在墙前调用 `resolveProjectilePath` 顺序处理扫掠命中，然后消耗穿透并弹射，保证命中和弹射共享资源。`resolvedTick` 避免兼容的命中阶段重复结算。所有发射入口经过同一个容量检查，反射入口也遵守狙击手限制。
- 地雷记录独立侦测/减速/爆炸半径、倍率、生命、引爆时长、移动方向和破片数。忽略弹丸与弱化倍率在放置时解析；手榴弹方向不随之后输入改变。掉落物按伤害来源生成，仅有效伤害触发，统一拾取阶段处理生命和棱晶。
- 只读快照携带锁定目标基本属性、两槽冷却、球形弹头轨迹、拾取物和引爆计时。指针换算允许传入当前模拟位置，用当前 tick 相机取代上一渲染帧相机，消除移动时鼠标不动的反馈抖动。
- 状态哈希覆盖锁定、技能、购买账目、子弹、地雷、掉落与导航状态，排除纯视觉轨迹、伤害高亮、飘字和特效。新增数值可由同种子/同意图完整回归。


## v1.9 指针输入与单文件发行

- 桌面 primary pointer 只更新瞄准/射击，secondary pointer 只提交锁定坐标；触屏轻点只提交锁定，开火由触控摇杆处理。右键空白由应用层目标命中测试转换为空锁定，不改动左键按住状态。
- `scripts/build-offline.mjs` 从相同 `app/main.ts` 入口创建 production IIFE，将 CSS 与脚本嵌入单个 HTML。构建拒绝残留 imports/动态 imports/外部资产，并验证脚本可作为普通 script 解析。输出目录被忽略，不进入 Sites 静态输出或源码提交；源修订仅写入不可见元数据。

## v1.10 主菜单、测试场与导航边界

- `app/main.ts` 持有一个当前会话，共享渲染器、输入、音频和设置；切换模式销毁旧游戏循环并创建新世界。`Game` 的 `home / menu / play` 状态统一清空输入和帧计时，主菜单冻结世界，继续不补算暂停时间。结束后仍可回主菜单，只有未结束且已开始的局显示继续入口。
- `app/modes/practice.ts` 在 `step` 前后装配测试能力，核心没有测试模式分支。前置步骤补充自由购卡额度与可选无敌帧，后置步骤累计有效伤害、维护 180 tick 窗口并恢复静态靶机。场景重置复用 `applyRoom`，保留购买与技能槽并清理临时实体；完整重开创建新世界清空构筑。普通闯关拒绝测试命令。
- 等级编辑只在暂停的测试场接收，校验卡片存在、整数范围及自身等级上限后，通过同一属性解析与技能协调管线生效；正常购买仍校验价格和前置。测试统计不写入核心快照，由应用层提供给 HUD 与测试控制页。
- 寻路用线段到矩形的实际最短距离检查圆形单位通路，允许合法的圆角和贴墙切线；航点仅在下一段可通行时跳过。意外重叠的敌人先用已有确定性碰撞恢复函数移出墙体再重新规划。子弹墙体命中继续使用原有扫掠判定。

## v1.11 共享规则与函数化卡片

- `content/cards.ts` 的参数函数返回加法、乘法、除法、赋值或概率复合操作，统一工厂从同一组操作生成 `effectFn` 与 `summary`。纯开关使用独立工厂保留 1 级；可回收不再自动意味着限 1 级。价格仍为等级的纯函数。
- `core/rules.ts` 提供追踪、技能、连发、手榴弹、掉落与回收的共享参数/成长函数，由物理和文案共同读取。狂暴/冲刺等级同时影响临时属性及当前技能说明。转弯角速度不受狙击手额外惩罚，速度改变自然改变曲率。
- `Projectile.travelLeft` 是剩余累计路径长度，逐段按实际推进量扣减；慢速/减速只影响单位时间推进量。移除旧极小位移阈值，避免很慢的弹丸停止移动或残余射程永不耗尽。
- 测试场等级编辑取消 20 级限制，先检查安全整数与最终属性的有限性，再提交构筑；授予等级不分配 O(等级) 支付数组。自由购卡按当前报价临时补足额度，高等级价格不再受固定测试额度阻挡。普通购买拒绝不可计算的数值而不修改世界。


## v1.12 无尽控制器、资源与弹丸反馈

- `app/modes/endless.ts` 独立管理层数、世界种子、按层派生的 RNG 和延迟补刷队列。通过现有 `applyRoom` / `spawnEnemy` 注入随机房间和敌人；核心不知道无尽模式。每层使用独立种子流，战斗掉落不会改变下一层布局。重新开始回到同种子第 1 层。
- 有限层对每个战斗属性检查相对层数参考值的上界；开放层保留 Pareto 尾部，仅受浮点数有限表示约束。死亡实体在模式后置步骤删除，并按 tick 队列补刷；传送门的开放不依赖杀敌。模式状态通过应用层传给菜单和 HUD。
- `core/roomResources.ts` 生成确定性的房间资源规格，`createWorld` / `applyRoom` 每次入场消费一次，负 TTL 表示保持至拾取/切房。空的 `pickups` 规格可供测试场禁用房间资源。清场系统只开门，不发通关奖励。
- `Actor.rewardMultiplier` 是单个敌人的棱晶收益系数，发射时复制到弹丸与地雷，转移所有权时一起更新。目标收益系数用于伤害/溢出/掘金收入，来源系数用于受伤收入；死亡源被删除后，已发射弹丸仍保留系数。
- `hitIds` 只表示尚未与碰撞体分离的接触；每个扫掠段开始清理已分离接触，支持同 tick 弹射回击而不在重叠期间连续扣血。存活穿透后复制的推进参数增加速度、最高速度及剩余射程。
- `rangeBudget` 记录初始射程和飞行中新增的距离预算；只读快照将 `travelLeft / rangeBudget` 归一化为 `rangeRatio`，渲染器据此调整弹头、尾迹、光晕颜色与亮度。光效不反向改变战斗行为。
- 函数卡工厂支持由当前属性决定是否生效的纯条件。狙击手优先级 100 先设置一弹上限，连发优先级 110 再判定整卡暂停，购买顺序无关；构筑重算与武器更新均清除失效待发轮次。卖完狙击手后重跑相同管线恢复连发。
- 所有生产卡均允许逐级回收，保留实付账目和 60% 退款。前置只在购买时校验，卖出不级联撤销其他卡。磁铁由属性半径和 `Intent.autoPickup` 共同控制；配置 v3 保存开关并兼容 v1/v2，重开或重新购买不覆盖关闭偏好。


## v1.13 存档、升级计划与真人对战

- `core/serialization.ts` 只处理纯世界数据：函数型 registry/economy 通过注入重新附加，Map 转数组；拒绝非有限数值、危险键、过深/过大数据、重复实体编号及无效卡片。`hashWorld` 忽略缺失与 undefined 的表示差异，使 JSON 往返保持同一确定性状态。
- `app/checkpoints.ts` 负责版本化会话进度，`Game.checkpoint()` 捕获战斗世界、房间索引、原始种子、重开计数、无尽 RNG/补刷队列与预购计划。读档直接恢复世界和模式状态，不调用重新入场生成器；清空设备输入与帧补算。
- `storage/saveStore.ts` 使用独立槽位键 `prism.save.v1.*`，写失败保留旧槽。`app/saveManager.ts` 管理自动保存、文件校验、导入/导出与可读摘要；直接导出当前进度不依赖 localStorage。配置、单人进度与预设使用不同格式和存储键。
- `app/upgradePlans.ts` 校验可移植目标和快捷栏，`Game` 在非暂停单人帧末依次处理最多四项预购，继续复用真实购买入口。预设不伪造免费购买记录；队列、开关与已购等级独立。`planManager` 负责命名集合与文件，快捷购买只在单人 play 状态接收 1–5。
- `content/duel.ts` 定义标准装备与规则；`app/modes/duel.ts` 维护双方准备、倒计时、回合、比分、交换侧和超时结果，复用同一核心模拟。敌方 Actor 收到外部 Intent 时不再由 AI 覆盖；受伤无敌时长可按 Actor 注入，双方保持一致。
- `net/peer.ts` 只封装浏览器 WebRTC 与邀请/回应，取消连接时关闭通道并清理计时器；`net/protocol.ts` 对消息、标准装备和远端输入进行校验，序号与回合防止旧输入重放。失联输入归零、技能/锁定动作消费一次，通道积压不继续堆积状态。
- `duelSession.ts` 由房主模拟 60 Hz、下发状态 20 Hz，客机只发送 Intent 30 Hz，客机不执行第二份战斗判定。双方依据自己的 viewerId 生成视角，自己的单位始终显示为玩家色；核心不引用网络或 UI。对战期间单人 Game 冻结，退出恢复主菜单。
- 当前传输没有 TURN 中继、发现服务、断线重连或房主迁移；不宣称能穿透所有 NAT。版本协议需要随不兼容战斗修改提升，网络会话不作为局内存档恢复。


## v1.14 多参与者与有序购买

- 可选 `World.participants` 按 actor ID 保存独立钱包、购买账目与复活次数；`progress` 的购买/出售/列表接口接受 actor ID，继续复用同一属性管线。单人保持原字段与存档兼容，单人导入拒绝网络世界。
- `neutral` 阵营怪物对双方敌对。外部控制的双方不被 AI 接管，怪物选择最近的活玩家，碰撞、接触伤害、吸血/复活、磁吸拾取均对称；客机快照只交换玩家/敌方身份，不把中立怪物显示为友军。
- `content/duel` 定义三种规则和刷新预算，模式控制器维护有种子的调度，准备阶段购买不被开局重新建世界丢失；每轮结束重置双方余额/构筑，保留目标列表。客机 action 请求有独立序号和回合校验，房主执行真实购买，快照核验双方属性与账目。
- `purchaseQueue` 使用战斗 tick 维护同一报价的180 tick可见提示期。单人和联网均复用；队首不可购买、切换收藏、暂停或计划更改使提示重新计时。每次升级重新等待，不存在隐藏立即自动购买路径。
- 预设 v2 按数组顺序保存允许重复的累计目标，载入不重排。重复卡片的等级严格递增，最终构筑校验聚合每张卡的最高目标而非重复叠算。编辑移动时保留同卡递增等级，删除时扣除对应未来升级。
- 收藏和购买方式持久化于 `prism.builds.v2`，兼容 v1 文件及旧存储；五格快捷键已移除。屏幕边缘组件只在活跃战斗显示可购项，菜单与倒计时不触发。
- RTC 逻辑协议 v2，快照上限512KiB，传输分为12000字符小帧后有界重组，避免大于底层消息大小时断线；断序/超时丢弃，可由下一条完整快照恢复。


## v1.15 难度生成与可保存波次

- `content/difficulties` 统一定义七档曲线与开局预算，`buildDungeon({seed,difficulty})` 生成完整可复现布局和波次；无参数调用保留旧固定内容以兼容旧存档和原测试。内容生成RNG与战斗RNG隔离，不因渲染或后续战斗改变未到达房间。
- 通用可选 `RoomTemplate.waves` / `World.waves` 存放后续敌人。首波保留跨房入场门槛；`updateRoom` 只有当前波敌人全死后才启动90 tick预警，倒计时结束创建下一波；全部结束再走原清场/Boss逻辑。快照提供出生点和当前/总波数，渲染预警不写回逻辑。
- `RunCheckpoint.difficulty` 可选，以兼容旧v1文件。新种子闯关重开不改seed，读取完整世界不再授予预算；重建未来房间使用保存的种子/难度，不重新生成当前波次。哈希纳入波次、参与者钱包与资源规则，覆盖这些未来影响字段。
- 云浏览器实测没有ICE候选时不继续输出不可用连接代码，明确提示未获得网络地址。它不能替代实际设备/NAT网络下的真人联机验证。

- `RunCheckpoint.name` 为可选元数据，旧文件无需迁移。`saveManager` 统一保留目标槽名、校验新名、传播当前已加载/保存槽名并生成安全文件名；重命名不更新进度时间。存储失败与导入校验失败保留旧槽字节。


## v1.16 卡片数值与存档迁移

- 悬浮弹芯的弹速与射程均使用 `formulaCard` 的同一修饰表生成效果、下一级累计说明和最终属性。发射时从最终射程初始化距离预算；出售重跑管线，撤销两个修饰。
- 单人存档新增可选 `balanceVersion`，当前为2。无标记且与当前属性不一致的文件，只有在所有玩家属性精确匹配旧悬浮弹芯管线后才允许迁移；随后写入当前属性与标记。已有弹丸、账目、种子、房间/波次、名称与时间均保留。当前版本属性不符和未知版本继续拒绝。
- 联机协议提升至3，避免旧版对局在购入这张卡后才发现双方数值不同；两边刷新后重新配对。

## v1.17 卡片合并、购买约束与历史界面

- `content/cards` 只注册49张现行卡，`cardRoles` 提供用途及5个旧ID别名；`legacyCards` 冻结原54张卡的v1/v2数值与价格，仅用于导入核验。当前效果/价格/数值说明继续同源生成，不将审阅结论或变更历史放入用途文案。
- `app/cardMigrations` 统一将存档数值版本升至3：先用对应旧注册表验证完整玩家属性，再合并等级和逐级实付数组，注入当前注册表重算并恢复旧当前生命/盾量（受新上限约束）。未标版本只接受严格匹配的旧1/2版，不宽松修复任意属性。旧实体、种子、RNG、名称、波次和冷却保留；已有晶片标记 `gainApplied`，避免重新乘收益。
- 预设、收藏及局内预购复用别名转换。有序目标按旧ID独立里程碑计算，再累加合并ID；存档还纳入合并前已买级数，保留未完成步骤和原顺序。输出只有现行ID，重复收藏去重，未知ID仍报错。
- `Card.unavailable(attrs)` 处理当前装备约束，`World.cardRestrictions` 注入模式约束。购买列表和真实购买共用检查，UI显示具体原因，自动购买不会绕过。禁购不代表删除已有卡；例如狙击手下的连发/霰弹通过优先级110及 `enabled` 整卡暂停，出售狙击手即恢复。
- 护盾池须 `attrs.shield>0` 才启用；护盾回充/虹吸在优先级30检查模块。晶片生成记录基础值，拾取者收益只在拾取时应用；固定收入与出售不经过此路径。
- 对战双方 `damageIframesTicks=0`，不吞掉独立连发/霰弹/高射速命中；`contactCooldownTicks` 独立门控30tick近战接触，计入计时器、序列化和状态哈希。复活无敌照常，单人规则不受影响。协议4核验双方受伤规则及模式卡片约束，拒绝旧客户端。
- `content/changelog` 保存发行记录，`ui/sections/changelog` 由主页和暂停菜单共同呈现。构建打包本地记录，不依赖运行时请求；卡片、帮助、属性与实战HUD只描述当前规则。


## v1.19 伤害类型、能量武器与敌人组合

- `AttrSet` 加入固定格挡、三种元素抗性、武器选择和四个专精等级；`DamageEvent.damageType` 与弹丸属性贯穿直击/爆炸/持续伤害。唯一伤害入口按无敌→格挡→护甲→抗性→护盾→生命结算，真实死亡统一计算基础概率与溢出的击杀掉落；自爆走独立死亡入口，不冒领击杀奖励。
- `energyWeapons` 在核心解析即时电弧/激光，使用真实几何、路径距离、独立穿透预算和稳定ID次序。激光持续计时保存在Actor，纯表现轨迹 `World.traces` 不参与哈希，保存/网络可选携带。当前武器改变或进入新房间会结束持续照射；买入单弹构筑也清理旧照射。不存在第二套客户端判定。
- 电弧全方向预选互异起点，锁定和方向只决定优先级；各链独立已访问集合与穿透，每跳独立距离/遮挡，不再为其它根节点预留目标。先确定可达链路，再将穿透分配给命中、增强跨跳和剩余增伤。激光逐段排序碰撞，消耗穿透后才反射，脉冲之间允许再命中，同一脉冲不因折射重复结算同一目标。
- `Mine` 记录段数、剩余段数、引爆阶段、蜂巢等级、子雷标记与期限。更新遍历稳定副本，新增子雷下一tick处理，末段才调用一次收尾。`mineLimits` 独立裁剪母/子雷，购买/出售/布雷共用，卖完蜂巢撤回现有子雷并停止待引爆母雷繁殖。子雷的繁殖等级为0，不能递归。
- 原型与纯内容词条函数在 `content`；随机生成以同一内容RNG复现，有限无尽层在词条应用后再次检查上界。AI增加保持距离/侧移、蓄能锁向与自爆状态；这些计时与燃烧/减速都进入世界序列化和状态哈希。伤害过程中创建的死亡弹幕不得被弹丸更新的数组替换吞掉，弹丸更新使用稳定初始集合与当前存活集合合并。
- 数值版本4引入新属性schema：老版本在固定字段路径补默认值后，由冻结v1/v2/v3注册表严格核验并转换。v3晶片已采用原始价值，不能再次标记为已乘收益；旧1/2版维持历史已计价处理。当前版不能缺字段，未知版本/卡片/属性继续拒绝。网络协议6传递元素、词条、状态、持续照射与轨迹，并校验双方合法构筑。
- 渲染共用 `weaponPalette`，以阵营、伤害类型、剩余路径/能量、伤害强度产生配色；实体弹、射线、飞船武器与瞄准标识复用。锁定面板增加格挡/抗性/词条，危险圈和蓄能线表达可躲避机制。游戏说明只写当前规则，发行变化仍在独立日志。

- `core/loot` 统一概率函数、分数抽奖、625单次击杀点数限额、贪心面值打包和实体预算。使用世界RNG，仅分数部分耗随机数；不同资源分别抽奖。`Pickup.quantity` 可选、正安全整数，缺省1；存档校验、哈希、网络、拾取和渲染都包含堆叠数。房间资源与PvP刷新用相同打包函数，大面值与数量控制实体规模，旧资源面值不追溯修改。世界数值schema仍为4，卡片永久属性算法未改，现有v4可直接读取。
- `renderSettingsSection` 内部保留当前设置并在每次提交后重绘，主菜单/暂停页共用同一路径，连续操作不会读取初始闭包值。`readDuelIntent` 同时要求卡片与用户自动偏好；核心自动索敌允许全方向可见目标，手动方向锁仍保留前方扇区。激光伤害和散射使用 `laserProfile` 共同生成描述与实效。


## v1.20 设计关卡、巢母与输入

`content/levelSets` 管理确定性关卡池与矩形地板补集压缩，盘丝洞以通道路径定义几何，RoomDesign保存名称、核心区、巡游点、布雷点与两个出口。切房同步bounds/design，普通清场使用设计出口，开放层入口侧支路可跳过。安全屋使用小尺寸边界。

`systems/weaver` 分离巢母、工蛛和自爆幼蛛状态，缓存、冷却、派送目标、追击、一次冲刺、半血填充均序列化并进入哈希。工蛛导航在安全边距被移动消耗时恢复间距，避免合法物理位置无法重新寻路。死亡巢母的子体与雷清理，召唤物不加入无尽补刷队列。协议7、数值版本5；冻结v4和更早价格/效果保留实付退款。

闪电用每起点BFS无环树，父节点与深度决定渲染路径和伤害，层级强化保证同深度衰减一致。输入按真实射程/遮挡选择自动模式，停止射击参与脱战。键位独立持久存储；按键编辑阻止冒泡，购卡筛选保留本次会话。音效只在表现层生成，不影响模拟随机数。


## 合作房间装配

`app/modes/coop.ts` 组合种子闯关/无尽与独立参战钱包；`core/coop.ts` 处理复活与资源分配，不依赖浏览器。合作和1v1共享通用模拟接口，但合作显式使用同阵营与 `World.coop`，没有伪装成敌对玩家。

`app/coopSession.ts` 使用房主为中心的最多4条 WebRTC 数据通道，房主固定60Hz推进，客机约30Hz上传操作，约10Hz接收权威快照。连接绑定席位，输入过期300ms归零，15秒失联标记离线，动作序号/速率和2MiB消息边界校验；连接使用独立的合作标识，1v1不能混用。世界快照缓存100ms且精简纯视觉拖尾/飘字。全体角色仍以确定性规则模拟，菜单仅影响本人的输入与预购。

`prism-coop-save` 包含所有席位、独立构筑/预购、房间人数快照、资源归属/贡献、复活计时和无尽随机状态。恢复时导出视角的成员成为房主，其他席位离线，世界暂停等待邀请；客户端也可导出最后快照。自动槽 `prism.coop.auto` 与单人槽隔离。没有在线匹配、TURN中继或无缝房主迁移，连接失败时保留存档并可重新配对。
