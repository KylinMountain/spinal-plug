# Claude Code 本地参考实现笔记

## 目的

本笔记记录对本机 `~/Projects/claude-code` 参考副本的技术观察。它用于校验 Spinal Plug 的适配与同步边界，不构成对任何未公开行为的产品承诺。

## 已观察到的机制

### 生命周期

参考副本定义了 `SessionStart`、`UserPromptSubmit`、`PreCompact`、`Stop` 和 `SessionEnd` 等 Hook 事件。其停止阶段会在主会话结束后触发后台记忆提取与周期整理。

Spinal Plug 映射：

| 参考事件 | Spinal Plug M0/M1 行为 |
| --- | --- |
| `SessionStart` | 解析 Project Space，从本地稳定视图生成 Boot Context，并异步检查远端更新。 |
| `UserPromptSubmit` | 生成限定 token 预算的 Turn Recall Context。 |
| `PreCompact` | 写入本地 checkpoint 预留点；M1 不持久化任务状态。 |
| `Stop` | 将显式或候选记忆追加至本地事件日志，再由 Outbox 异步处理。 |
| `SessionEnd` | 尝试刷新 Outbox，但不阻塞宿主正常退出。 |

### Team Memory Sync

参考副本的团队记忆同步具有以下工程特征：

- 启动时先拉取远端内容，再启动文件监听。
- 本地变化经过约两秒防抖后推送。
- 使用 ETag / `If-Match` 与 412 响应检测乐观并发冲突。
- 使用每条目的校验和计算增量上传。
- 扫描机密并跳过包含密钥的内容。
- 对无认证、无仓库或永久性 4xx 失败抑制无意义的重复重试。

这些机制是 Spinal Plug 的同步实现参考，但数据模型不能照搬。参考副本以文件为更新单位，且同名文件并发修改时不进行语义级合并；Spinal Plug 将以 `EventEnvelope` 为事实源、以 `MemoryRecord` 为物化视图，并在未来通过 revision 和 conflict 状态处理竞争写入。

## 对 M0/M1 的具体约束

1. Hook 不直接执行网络同步或模型提取，必须先写入 `local-node` 的 SQLite WAL / Outbox。
2. `SessionStart` 不等待网络；先加载本地稳定状态，远端更新进入后续 fetch / preview / apply 流程。
3. 重试可恢复错误，但对认证、权限、配置等永久错误进行退避或抑制，并报告可操作的状态。
4. 上传前预留 Secret Scanner 边界；M1 可以先实现接口与拒绝策略，M2 再接入完整扫描器。
5. Spinal Plug 不把 Claude Code 的私有自动记忆目录当作事实源，也不修改用户维护的条目。适配器仅维护带 `spinal-plug:managed` 标识的受管投影：上传时读取宿主主题记忆作为候选来源；同步后将已编译的项目记忆写入受管主题文件，并更新受管索引行。这个窄边界需要持续通过宿主版本兼容测试验证。

## 未来阶段的参考价值

参考副本的后台提取和 Dream / consolidation 流程支持“原始事件先累积、长期记忆后整理”的方向。Spinal Plug 的实现顺序保持不变：先验证显式项目记忆同步，再加入候选记忆、checkpoint、长期整合，以及未来的 Mind Core、Mind Capsule、Incarnation 与 Work State。
