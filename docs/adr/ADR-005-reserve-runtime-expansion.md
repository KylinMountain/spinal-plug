# ADR-005: 为 Mind Core / Mind Capsule / Incarnation / Work State 预留扩展位

## 状态

Accepted

## 日期

2026-07-23

## 背景

当前阶段只实现项目记忆同步，但后续明确要演进到更高层的 Mind Core、角色加载、分身运行时和任务交接。

## 决策

v0.1 只实现项目记忆同步对象，但保留未来扩展位：

- `EventEnvelope.runtimeContext` 预留 `incarnationId`、`roleProfileId`、`missionId`、`branchId`、`taskCheckpointId`。
- `ProjectionKind` 预留 `mind_capsule` 与 `work_state`。
- `ProjectSpace.type` 保持可扩展枚举。
- `MemoryRecord` 不混入任务检查点或运行时状态。

## 结果

优点：

- M0/M1 不为未来能力付出完整实现成本。
- 后续添加 `Mind Capsule` 或 `Work State` 时，无需推翻事件源和同步基础。

代价：

- 代码中会存在部分未启用的保留字段。
