# Codex 插件与自动候选记忆

插件位于 `plugins/mind-palace-codex/`，通过 marketplace 安装后由 `hooks.json` 驱动。项目已连接 Space 时，不需要用户反复执行 boot 或 share。

| 生命周期 | 行为 |
| --- | --- |
| `SessionStart` | 自动解析 Git Project Space、加载本地稳定记忆，并刷新 Codex 的受保留投影。 |
| `UserPromptSubmit` | 按当前问题注入少量 Recall Context。 |
| `PreCompact` / `SessionEnd` | 保持本地 WAL 与 Outbox 的耐久性，不阻塞 Codex。 |
| `Stop` | 从最终助手文本中保守提取至多三条候选记忆并写入本地队列；等待用户确认后才发布。 |

## 候选而非自动事实

自动提取只接受耐久的项目规则、已说明的决策、不可从代码轻易推导的背景与权威链接。临时任务进度、测试运行状态、密钥和完整对话都会被拒绝。候选始终标记为 `agent_inferred` 和 `candidate`；它不会自动进入启动上下文或覆写 Codex 的原生记忆。

插件只把已应用的中心规范记忆投影到 Codex 私有 Stage-1 数据库中的 `mind-palace:<space-id>` 保留记录。这个记录与用户会话分离；适配器从不扫描、覆盖或同步其他 Codex 原生记忆。Codex 升级后必须运行兼容性测试，失败时改为 Context Projection。

## 手动动作

`/mind-palace` Skill 仍保留：

- `status`：查看当前连接、候选和待同步事件。
- `candidates` / `promote`：审查自动候选，并只在用户明确确认后晋升为 active。
- `sync`：获取、预览并选择应用其他 Agent 的规范记忆。
- `share`：当用户希望立即补充一条明确项目记忆时使用。

本地数据库只是设备缓存、WAL 与 Outbox；同步传输的是版本化事件和规范更新，绝不上传数据库文件。
