# ADR-012: Mind Core、Capsule 与 Incarnation 作为独立运行时平面

## 状态

Accepted

## 日期

2026-07-24

## 背景

项目记忆与 Checkpoint 已能在 Claude Code 和 Codex 间同步，但“加载一个记忆体后形成新的可工作分身”还需要稳定身份、角色、任务图和生命周期。把这些短中期运行时状态写入 `MemoryRecord` 会污染长期记忆，并让并发分支失去边界。

## 决策

- 新增独立的 `runtime.*` 事件和 SQLite `runtime_entities` 物化表。
- `MindCore` 绑定 Persona、Project Space 和默认同步策略；它是逻辑心智中心，不代表模型权重或隐藏状态。
- `RoleProfile`、`Mission`、`TaskGraph` 描述该分身的职责、目标与工作图。
- `MindCapsule` 将上述运行时实体、当前 Project Boot Context、记忆引用和最新 Checkpoint 编译为可读的启动包。
- `Incarnation` 是 Capsule 在某宿主、设备与会话上的一次具身化，生命周期为 `active / hibernated / retired`。
- 所有运行时实体复用 WAL、Outbox、事件同步和设备/Space ACL；中心不把它们交给 Canonical Memory Compiler。

## 结果

已有项目记忆同步协议不需要改写。当前实现是单 Project Space 的最小垂直切片；跨 Space Mind Core、并发 TaskGraph 合并、动态宿主能力探测和控制台的 Capsule 操作将在后续阶段扩展。
