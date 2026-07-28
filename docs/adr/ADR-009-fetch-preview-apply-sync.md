# ADR-009: 同步拆分为 Fetch、Preview 与 Apply

## 状态

Accepted

## 日期

2026-07-23

## 决策

- 原始事件 Pull 保留为审计与兼容接口，面向用户的同步使用中心编译后的 `CanonicalMemoryUpdate`。
- `fetch` 将规范更新写入本地 `sync_inbox`，推进独立 fetch cursor，但不应用普通更新。
- `preview` 从本地收件箱展示 update ID、规范状态、来源事件与内容。
- `apply` 接受一个 update ID 列表，只将所选规范记录写入本地记忆视图。
- 不传 update ID 代表用户明确选择全部更新。
- Tombstone 更新标记为 `required`，在 fetch 后立即应用，防止旧设备让已忘记记忆复活。
- Claude Code 与 Codex 分别通过 `apply-claude` 和 `apply-codex` 在选择完成后刷新原生记忆投影。
- 原有 `synchronize` 保留为 Follow Stable 兼容模式，内部执行 fetch 后全部 apply。

## 结果

“发现远端更新”和“让当前分身使用更新”不再是同一个动作。用户可以查看其他 Agent 的进展而不改变当前会话，同时安全删除仍能优先传播。
