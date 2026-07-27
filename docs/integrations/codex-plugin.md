# Codex 插件与自动候选记忆

插件位于 `plugins/spinal-plug-codex/`，通过 marketplace 安装后由 `hooks.json` 驱动。项目已连接 Space 时，不需要用户反复执行 boot 或 share。

| 生命周期 | 行为 |
| --- | --- |
| `SessionStart` | 自动解析 Git Project Space、加载本地稳定记忆，并刷新 Codex 的受保留投影。 |
| `UserPromptSubmit` | 按当前问题注入少量 Recall Context。 |
| `PreCompact` / `SessionEnd` | 保持本地 WAL 与 Outbox 的耐久性，不阻塞 Codex。 |
| `Stop` | 从最终助手文本中保守提取至多三条候选记忆并写入本地队列；等待用户确认后才发布。若项目既无 active 记忆也无待审候选（空记忆室），额外注入一次 `<spinal-plug_memory_nudge>` systemMessage，引导宿主从当前会话生成最多 3 条事实并以 `remember --candidate` 落为待审候选——每个会话最多提醒一次（需 payload 带 `session_id`），一旦有可审阅内容即永久停止。 |

## 候选而非自动事实

自动提取只接受耐久的项目规则、已说明的决策、不可从代码轻易推导的背景与权威链接。临时任务进度、测试运行状态、密钥和完整对话都会被拒绝。候选始终标记为 `agent_inferred` 和 `candidate`；它不会自动进入启动上下文或覆写 Codex 的原生记忆。

插件只把已应用的中心规范记忆投影到 Codex 私有 Stage-1 数据库中的 `spinal-plug:<space-id>` 保留记录。这个记录与用户会话分离；适配器从不扫描、覆盖或同步其他 Codex 原生记忆。Codex 升级后必须运行兼容性测试，失败时改为 Context Projection。

## 手动动作

`/spinal-plug` Skill 仍保留：

- `status`：查看当前连接、候选和待同步事件。
- `candidates` / `promote`：审查自动候选，并只在用户明确确认后晋升为 active。
- `sync`：获取、预览并选择应用其他 Agent 的规范记忆（需先配置 `SPINAL_PLUG_SYNC_URL`)。
- `share`：当用户希望立即补充一条明确项目记忆时使用；空记忆室时会从当前会话生成首批记忆。命名参数形式：`spinal-plug share <db> <dir> <kind> --url <url> --device-id <id> "<text>"`(flag 在文本之前，文本永远原文保存）。分享前先运行 `spinal-plug keys <db> <dir>` 读取语义键注册表，已有键能覆盖时用 `--key` 复用（编译器按键合并与判冲突），都不合适才新建 kebab-case 键。

本地数据库只是设备缓存、WAL 与 Outbox；同步传输的是版本化事件和规范更新，绝不上传数据库文件。

默认**本地优先**：不配置 `SPINAL_PLUG_SYNC_URL` 时所有操作都在本机完成，无端点、无认证，开箱即可测试；`sync-codex` 是无网络的纯本地原生投影刷新。需要同步时显式启动 `spinal-plug serve` 并导出端点地址。

## 项目交接

当用户要求“交接给 Claude Code”“保存当前进度”或“让另一个分身继续”时，Codex 应创建 Project Checkpoint，而不是保存成长期记忆：

```bash
spinal-plug checkpoint "$SPINAL_PLUG_DB" . '{
  "title": "Payment migration handoff",
  "completed": ["Created the dual-write schema migration"],
  "decisions": ["Keep old consumers compatible for seven days"],
  "openTasks": ["Update PaymentConsumer idempotency"],
  "blockers": ["Staging database permission is missing"],
  "nextAction": "Inspect PaymentConsumer retry handling",
  "artifactRefs": ["migrations/20260724_payment.sql"]
}'
```

已确认的 checkpoint 会在 Codex `Stop` 阶段自动发布。另一设备执行同步后，下一次启动 Context 会出现最新 handoff 区块；也可通过 `spinal-plug handoff "$SPINAL_PLUG_DB" .` 查看。
