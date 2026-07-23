# M1 本地项目记忆闭环

M1 的目标是让同一台机器上的 Claude Code 与 Codex 使用同一份独立项目记忆。数据首先写入 Mind Palace 本地 SQLite WAL；云端同步、自动候选提取和任务交接不在本阶段实现。

## 初始化项目

在项目根目录执行：

```bash
mind-palace init ./.mind-palace/mind-palace.db .
```

这会创建 `.mind-palace/space.json`。其中的 `spaceId` 是跨设备关联项目的稳定标识，不使用本机绝对路径作为身份。若仓库配置了 `origin` remote，初始化也会记录其规范化 URL，作为人工核验和未来链接辅助信息。

> 当前 `.mind-palace/mind-palace.db` 是本地状态，应该忽略；`space.json` 可以按团队需求提交或保持本地。M2 会提供显式 Space Link，使不同设备可绑定到同一个中心 Space。

## 显式记忆

```bash
mind-palace remember ./.mind-palace/mind-palace.db . decision "支付迁移采用双写，避免计划停机。"
mind-palace list ./.mind-palace/mind-palace.db .
mind-palace recall ./.mind-palace/mind-palace.db . "支付迁移怎么做？"
```

M1 只接受显式写入。`directive`、`decision`、`context` 和 `reference` 是当前允许的记忆类型。每次创建、更新或删除都会：

1. 追加不可变 `EventEnvelope`。
2. 更新本地 `MemoryRecord` 物化视图。
3. 放入 Outbox，等待 M2 的同步客户端上传。

```bash
mind-palace update ./.mind-palace/mind-palace.db . <memory-id> "更新后的表述"
mind-palace forget ./.mind-palace/mind-palace.db . <memory-id>
mind-palace list ./.mind-palace/mind-palace.db . --all
```

`forget` 不删除历史事件，而是写入 tombstone 状态，因此远端同步完成后旧设备可以收到删除指令，而不是重新上传已删除的内容。

## Hook 调用契约

两个 Adapter 通过同一个 CLI 入口调用：

```bash
mind-palace hook claude-code session.start ./.mind-palace/mind-palace.db .
mind-palace hook codex prompt.submit ./.mind-palace/mind-palace.db . "当前用户提示"
```

输出是 JSON，其中 `additionalContext` 可传给宿主允许的上下文注入字段。`session.start` 生成 Project Boot Context；`prompt.submit` 仅生成当前问题相关的 Recall Context。`stop`、`pre.compact` 与 `session.end` 当前只保留生命周期位置，不自动从会话提取记忆。

实际宿主 Hook 应使用 stdin 桥接命令，而不是手写命令参数。该命令读取宿主传入的 `cwd`、`session_id`、`hook_event_name` 与提示字段，再输出宿主要求的 JSON：

```bash
mind-palace hook-stdin claude-code /absolute/path/to/mind-palace.db
mind-palace hook-stdin codex /absolute/path/to/mind-palace.db
```

Codex 的项目级 Hook 可放在受信任项目的 `.codex/hooks.json`。示例只配置启动和提示阶段：

```json
{
  "description": "Mind Palace project memory",
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "mind-palace hook-stdin codex /absolute/path/to/mind-palace.db",
        "timeout": 5
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "mind-palace hook-stdin codex /absolute/path/to/mind-palace.db",
        "timeout": 5
      }]
    }]
  }
}
```

Claude Code 的桥接输出采用其 `hookSpecificOutput.additionalContext` 形状；Codex 的桥接输出采用当前公开 Hook 文档中的 `systemMessage` 形状。两者都必须先由用户审核并信任 Hook 定义。

## M1 边界

- 不写入 Claude Code 或 Codex 的私有记忆目录。
- 不上传完整会话记录。
- 不在 Hook 关键路径中进行网络请求。
- 不自动把助手输出视为长期记忆。
- 不实现工作状态、Mission 或 Incarnation；协议中的对应字段只作为兼容性预留。
