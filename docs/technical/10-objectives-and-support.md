# 10. 房间目标与支援敌人

适用 v1.29，实时协议 prism-server-6，数值存档版本仍为7。玩法和数值以 `docs/requirements.md`、`docs/balance.md` 为准。

## 房间构造与生命周期

`src/content/levelSets.ts` 定义闸廊、矿室的布局；`src/content/objectives.ts` 根据布局把普通波的一部分预留为闸廊增援，或从守军取最多两名建立矿室额外挑战。冒险 `src/content/dungeon.ts` 和无尽 `src/app/modes/endless.ts` 用种子生成；开放层不绑定目标，传送门按原规则始终开放。闸廊左右各一个可达节点，接近一个节点锁定路线，1.5秒后生成预留敌人；所有波次和增援结束后才开门。矿室普通守军清理后仍可直接离开，在矿点站立2秒可选择挑战，启动后关门、预警并生成额外守军。完成一次性掉落25×1.13^深度（取整、上限625）棱晶，使用已有拾取与合作资源规则。

`src/core/world.ts` 的 `ObjectiveSpec/ObjectiveState` 保存预设敌人、节点、阶段、倒计时、持有人、目标ID和领取状态；`src/core/systems/objectives.ts` 每tick执行转换，`room.ts` 防止预警或待选闸廊提前通关。`dungeon.ts` 切房清理区域并初始化目标；序列化器对结构与边界进行校验。旧档没有这些可选字段时按无目标处理。合作服务器在 `src/app/modes/coop.ts` 对目标守军扩编，任一存活在线玩家可触发，状态随完整世界存档。

## 支援单位

`src/content/enemies.ts` 定义封路者与召援者，遭遇角色由 `encounters.ts` 随难度/层数解锁。`src/core/systems/ai.ts` 实现60 tick预警与状态机；封路者有效受击打断预警，成功后在固定落点生成180 tick区域，每30 tick结算电伤并检查墙体遮挡，全场最多4个。召援者最多2次，间隔240 tick，同时最多6个召唤体；召唤体继承部分属性并追击。`damage.ts` 禁止利用召唤体获取伤害经济、吸血、分数、连杀和掉落；开放层死亡时也不排队补刷召唤体。支援敌人不获得自爆词条，避免破坏其预警语义。

## 显示、传输与测试

`snapshot.ts` 将目标、区域和敌人预警转换为只读视图；`render/canvas2d/renderer.ts` 绘制警示、节点、倒计时和敌人颜色，低画质也保留机制标记。`net/sync.ts` 的Actor字段字典和场景元数据随服务端权威状态传输，协议6要求客户端及服务器同步升级。`tests/unit/objectivesAndSupport.test.ts` 覆盖可达性、种子生成、预警、存档、合作触发、开放层、打断、有限召援、经济隔离与增量同步；其余集成测试覆盖联机、关卡和现有玩法。
