# ADR-003: 使用 Local Node + SQLite WAL 作为首版本地运行时

## 状态

Accepted

## 日期

2026-07-23

## 背景

Hook 生命周期通常要求低延迟、可离线、少依赖。首版不应在 Hook 中直接做远端网络请求，也不应让 Claude Code/Codex 分别维护不同格式的本地缓存。

## 决策

采用本地统一运行时：

- `local-node` 负责 SQLite 数据库初始化、WAL、Outbox 与 Cursor。
- Hook 只做轻量调用，把事件与上下文请求转给 `local-node`。
- SQLite 开启 `WAL` 模式，并在本地保留 `events`、`memories`、`outbox`、`sync_cursors` 等表。

## 结果

优点：

- 写入快，适合离线与重试。
- Claude Code / Codex 共用同一本地事实源。
- 后续可把同步客户端、上下文编译器和 Secret Scanner 放在同一进程中。

代价：

- 需要维护一个本地状态进程或库。
