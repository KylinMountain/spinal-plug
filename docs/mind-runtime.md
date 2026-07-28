# Mind Runtime 最小工作流

当前运行时是单个 Project Space 内的最小垂直切片。它将长期记忆、Project Checkpoint 与“分身运行状态”分开保存，并以相同的 WAL/Outbox 同步。

```text
Mind Core
  -> Role Profile + Mission + Task Graph
  -> Mind Capsule (可挂载启动包)
  -> Incarnation (某个 Agent / 设备 / 会话的具身化)
```

`Mind Capsule` 只编译可验证的身份、角色指令、目标、任务图、同步策略、活动记忆引用和最新 Checkpoint。它不复制模型权重、隐藏状态或逐 token 的“意识”。

## CLI

先连接 Project Space，再以 JSON 创建运行时实体：

```bash
spinal-plug mind-core "$HOME/.spinal-plug/spinal-plug.db" . '{"displayName":"Kylin Work"}'
spinal-plug role "$HOME/.spinal-plug/spinal-plug.db" . '{"mindId":"mind_...","displayName":"Senior Coding Agent","directives":["Verify current repository state before acting."]}'
spinal-plug mission "$HOME/.spinal-plug/spinal-plug.db" . '{"mindId":"mind_...","title":"Payment migration","objective":"Migrate storage without downtime."}'
spinal-plug task-graph "$HOME/.spinal-plug/spinal-plug.db" . '{"mindId":"mind_...","missionId":"mission_...","tasks":[{"taskId":"consumer","title":"Update PaymentConsumer","status":"in_progress","dependsOn":[],"nextAction":"Inspect idempotency."}]}'
spinal-plug capsule "$HOME/.spinal-plug/spinal-plug.db" . '{"mindId":"mind_...","roleProfileId":"role_...","missionId":"mission_...","taskGraphId":"tasks_..."}'
spinal-plug incarnate "$HOME/.spinal-plug/spinal-plug.db" . '{"capsuleId":"capsule_...","host":"claude-code","deviceId":"dev_linux","sessionId":"session_..."}'
```

使用 `spinal-plug runtime <db> <project-dir>` 查看当前 Space 的已物化运行时实体。`share`、`promote` 与 `fetch` 会经 WAL/Outbox 同步它们；中心记忆编译器仍只编译 `memory.*` 事件。

要在 Claude Code 或 Codex 的下次 `SessionStart` 自动加载某个 Capsule，并为该会话创建 Incarnation，设置：

```bash
export SPINAL_PLUG_CAPSULE_ID="capsule_..."
```

未设置时 Hook 维持普通项目记忆加载，不会擅自选择角色或创建分身。

## 当前边界

- Mind Core 目前以一个 Project Space 为作用域；跨项目的个人 Mind Core 尚未启用。
- Task Graph 保留完整事件历史，但并发任务分支不会自动做语义合并。
- 当前 Capsule 选择通过显式 `SPINAL_PLUG_CAPSULE_ID` 环境变量完成；控制台中的可视化选择器和每个项目的持久默认 Capsule 尚未实现。
- Incarnation 的 `hibernated` / `retired` 状态目前只有运行时服务 API(`setIncarnationStatus`)，尚未暴露 CLI 命令；SessionStart 创建的 Incarnation 始终保持 `active`。
