# ADR-011: Project Checkpoint 与跨 Agent 交接

## 状态

Accepted

## 日期

2026-07-24

## 背景

长期记忆只应保存可跨会话复用的决策、规则与背景。一个 Agent 当前完成到哪里、下一步应做什么、缺少什么权限，必须能被另一个 Agent 立即接续，但不应污染 Canonical Memory。

## 决策

- 新增独立的 `ProjectCheckpoint` 事件与本地物化表，不使用 `MemoryRecord` 表示任务进度。
- Checkpoint 保存摘要、完成项、关键决定、未完成任务、阻塞、下一步和工件引用，可携带预留的 mission / branch 标识。
- `checkpoint.created` 通过现有事件 Outbox 与中心服务传输；中心快照保留 checkpoints，但记忆编译器忽略它们。
- 接收端的 `fetch` 通过独立 cursor 从原始事件流幂等恢复 checkpoint；不会将其回写到本地 Outbox。
- Project Boot Context 仅注入最新 active checkpoint，形成可读的 handoff 区块。当前不自动合并并发任务图，未来由 Work State Plane 的 branch / task graph 处理。

## 结果

优点：

- Codex 与 Claude Code 可以共享“已经完成、接下来做什么”的项目交接信息。
- 删除和冲突不会错误地被长期记忆策略处理。
- 现有 Event Store、认证和同步路径可以复用。

代价：

- 首版只提供线性、最新优先的 checkpoint 视图；并发分支之间的任务语义合并尚未实现。
- Agent 必须在完成阶段主动创建 checkpoint；后续才引入自动 handoff 提取与任务图。
