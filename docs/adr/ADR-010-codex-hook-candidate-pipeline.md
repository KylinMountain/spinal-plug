# ADR-010: Codex Hook 候选记忆管线

## 状态

Accepted

## 日期

2026-07-24

## 背景

Codex 的原生记忆不能作为跨设备事实源，但手动执行“共享记忆”会漏掉正常会话中已经形成的项目决定。直接上传完整 transcript 会造成隐私泄漏、低质量记忆污染与不可审计的自动写入。

## 决策

- Codex 插件注册 `SessionStart`、`UserPromptSubmit`、`PreCompact`、`Stop` 和 `SessionEnd` Hook。
- `SessionStart` 生成稳定的 Project Boot Context，并刷新 Codex 中受保留线程 ID 保护的原生记忆投影。
- `UserPromptSubmit` 只注入有界 Recall Context。
- `Stop` 仅在当前 Hook 输入包含最终助手文本时，使用本地保守规则提取最多三条 `directive`、`decision`、`context` 或 `reference` 候选。
- 原始 prompt 和最终回答不写入 Spinal Plug；本地 SQLite 只保存提炼后的候选、不可逆 source digest 与处理状态。
- 每个候选都以 `agent_inferred` 来源和低于自动晋升阈值的置信度创建为 `candidate`，且不在 `Stop` 中上传。只有用户显式晋升或中心编译器依据后续证据处理后，相关事件才允许发布，并可能成为 active。
- 候选作业使用 SQLite WAL、唯一 job key、事务领取和过期租约恢复，以防重试重复、进程崩溃丢失或并发 Hook 重入。候选事件在 Outbox 中处于 `held` 状态；晋升以同一事务释放候选事件并写入 `memory.promoted`，普通同步不会越过确认门槛。

## 结果

优点：

- 正常 Codex 会话具备自动且可审查的记忆捕获。
- 失败时保留本地候选与 Outbox，可在后续 Hook 重试，不阻塞宿主。
- 中心不会收到原始对话或凭据文本。

代价：

- 规则提取是保守的，可能漏掉需要语义推理才能发现的经验；后续可替换为权限受限的本地/云端提取器接口。
- Hook 运行时若不提供最终助手消息，`Stop` 只能完成可靠收尾，不能产生候选。
