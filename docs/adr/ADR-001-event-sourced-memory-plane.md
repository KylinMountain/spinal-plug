# ADR-001: 使用事件源协议作为记忆事实源

## 状态

Accepted

## 日期

2026-07-23

## 背景

Spinal Plug 首版要先跑通 Claude Code 与 Codex 的项目记忆同步。同步对象不能直接建立在宿主原生记忆文件、`CLAUDE.md`、`AGENTS.md` 或共享 Markdown 文件之上，因为这些介质缺少可靠的并发、来源、删除与幂等语义。

## 决策

Spinal Plug v0.1 采用事件源模型：

- `EventEnvelope` 是跨设备同步的最小事实单位。
- `MemoryRecord` 是事件派生后的本地或远端物化视图。
- `SyncCursor` 表示某个设备或适配器消费到的同步位置。
- 事件先进入本地 SQLite WAL，再异步进入远端同步层。

## 结果

优点：

- 为幂等、重试、断网恢复和删除墓碑预留基础。
- 为未来 `Mind Snapshot`、`Incarnation`、`Work State` 扩展保留父事件与运行时上下文字段。
- 不与任一宿主平台的私有内存实现耦合。

代价：

- 首版复杂度高于直接读写 Markdown。
- 需要本地物化层把事件整理成可注入 Agent 的上下文片段。
