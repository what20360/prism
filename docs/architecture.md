# PRISM 架构设计

| 项目 | 内容 |
|---|---|
| 版本 | v0.1 |
| 状态 | 设计定稿，待 M1 落地验证 |
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
  net/
    transport.ts        接口定义（首发空实现）
  storage/
    config.ts           版本化设置读写与迁移
  app/
    main.ts             入口
    game.ts             场景与模式装配
    modes/
      dungeon.ts        普通模式
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
