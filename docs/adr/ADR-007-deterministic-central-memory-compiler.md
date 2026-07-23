# ADR-007: 中心记忆采用确定性编译与显式语义键

## 状态

Accepted

## 日期

2026-07-23

## 背景

事件流能够保证多设备写入不丢失，但“最后一条事件覆盖”无法区分因果更新、重复记忆和并发冲突。中心需要从原始事件生成可审计的规范记忆，同时避免用不透明模型静默改写用户事实。

## 决策

- 适配器或候选提取器为同一决策槽提供稳定 `semanticKey`；中心编译器不猜测两段不同文字是否表达同一事实。
- `user_explicit`、`host_native`、`sync_import` 和 `agent_inferred` 作为来源写入事件，置信度限制在 `0..1`。
- 低于自动晋升阈值的 `agent_inferred` 记忆保持 `candidate`。
- 同语义键、同内容的记录合并 provenance，保留一个 active 规范版本，其余标记为 `superseded`。
- 通过 `parentEventIds` 明确继承旧版本的更新产生 `superseded`。
- 同语义键、不同内容且不存在因果支配关系时，所有 active 变体进入 `disputed`，不得静默选择赢家。
- `memory.dispute.resolved` 事件显式选择规范版本并记录被替代项。
- 持久化中心保存不可变 `remote_events`，同时维护可重建的 `canonical_memories` 与 `memory_disputes` 投影视图。

## 结果

中心重启后可从事件账本完整重建规范记忆。编译过程确定、可测试、可解释；未来可增加语义模型为候选项生成 `semanticKey`，但模型不能绕过状态机直接覆盖规范记忆。
