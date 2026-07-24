# SPINAL-PLUG

> **One memory core. Many capable hosts.**
> **一个记忆核心，多个可工作的分身。**

Spinal Plug is a cross-device project-memory client for AI coding agents. It lets a project’s durable decisions, working conventions, and essential context travel between compatible hosts such as Claude Code and Codex, without pretending that models share weights, hidden state, or consciousness.

Spinal Plug 是面向 AI 编程智能体的跨设备项目记忆客户端。它让项目中真正值得保留的决策、协作习惯和关键背景，在 Claude Code、Codex 等兼容宿主之间流动；它不复制模型权重、隐藏状态或所谓“意识”。

```text
CLAUDE CODE / CODEX                 SPINAL PLUG                    NEXT HOST

work in a project       publish      durable memory      project     load a bounded
make a decision      ───────────►    sync endpoint    ─────────►     native projection
correct a workflow                   preview / apply                 continue work
```

## Why / 为什么

An agent that opens a project on a second device should not need the user to restate every important decision. At the same time, blindly injecting every old chat message creates noise, stale context, and privacy risks.

Spinal Plug keeps the boundary deliberate:

- **Load / 加载**: start with a small, relevant project memory projection.
- **Work / 工作**: each host works independently in its own session and environment.
- **Return / 回归**: publish only durable signals, then let other hosts preview and choose what to apply.

The goal is project continuity, not an unbounded global prompt.

目标是项目连续性，而不是无限膨胀的全局上下文。

## The Experience / 使用体验

```text
MEMORY CORE BOOT SEQUENCE

[01/05] Project Space ............ LINKED
[02/05] Incarnation Link ......... BOUND
[03/05] Mind Capsule ............. READY
[04/05] Memory Fidelity .......... AVAILABLE
[05/05] Sync Uplink .............. ONLINE
```

These are visible runtime states:

| Term | Meaning |
| --- | --- |
| **Spinal Plug** | The project-memory link attached to a compatible agent host. |
| **Memory Fidelity** | The durable references available to the current session, not a fabricated percentage. |
| **Mind Capsule** | A bounded boot package. It will later grow into a richer role and work-state runtime. |
| **Incarnation Link** | The binding between the current host session and a Project Space. |
| **Sync Uplink** | The selected connection to a compatible sync endpoint. |

| 术语 | 含义 |
| --- | --- |
| **记忆脊椎栓 / Spinal Plug** | 挂载到兼容 Agent 宿主上的项目记忆链路。 |
| **记忆保真度 / Memory Fidelity** | 当前会话可用的持久记忆引用，不是虚构的同步百分比。 |
| **心智胶囊 / Mind Capsule** | 有界的启动包；后续可扩展为角色与工作状态运行时。 |
| **具身链路 / Incarnation Link** | 当前宿主会话和 Project Space 之间的绑定。 |
| **同步上行链路 / Sync Uplink** | 到兼容同步端点的受控连接。 |

## What It Preserves / 它保存什么

Spinal Plug is for information that is costly to rediscover and remains useful across sessions:

- A technical or product decision and its rationale.
- A durable project rule or workflow correction.
- Context that is not obvious from the repository.
- A pointer to an authoritative external reference.

Spinal Plug 不适合保存密钥、完整对话、瞬时任务进度，或必须重新从代码验证的事实。当前工作进度应通过 checkpoint/handoff 处理，而不是污染长期记忆。

## Selective Synchronization / 选择性同步

Receiving an update and using it are separate actions:

```text
Fetch  →  Preview  →  Apply  →  Native projection
获取      预览        选择应用     写入宿主可读投影
```

You can see what another agent learned before it changes the current session. Deletions and access revocations remain safety-critical exceptions.

你可以先看见其他分身产生了什么，再决定是否把它带入当前会话。删除和权限撤销属于安全例外，应优先执行。

## Supported Hosts / 已接入宿主

| Host | Current integration |
| --- | --- |
| **Claude Code** | Hook-driven context loading plus a managed Auto Memory projection. |
| **Codex** | Lifecycle hooks, bounded candidate extraction, and a reserved native-memory projection. |
| **Future hosts** | Extend through the adapter contract and MCP surface without changing the local memory model. |

Spinal Plug does not replace any host’s native memory system. It maintains only its own managed projection and leaves user-owned memory untouched.

Spinal Plug 不取代宿主原生记忆系统，只维护自身受管投影，不覆盖用户已有记忆。

## Quick Start / 快速开始

### 1. Build the client / 构建客户端

```bash
pnpm install
pnpm build
pnpm typecheck
```

### 2. Connect a project / 连接项目

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
spinal-plug boot "$HOME/.spinal-plug/spinal-plug.db" .
```

The local SQLite database is a private device cache and outbox. It is never uploaded as a database file.

本地 SQLite 数据库是设备私有缓存和 Outbox；同步的是带来源与版本信息的事件，而不是上传整个数据库文件。

### 3. Connect a sync endpoint / 配置同步端点

```bash
export SPINAL_PLUG_SYNC_URL="https://your-sync-endpoint.example"
export SPINAL_PLUG_DEVICE_ID="device-local"
```

The public client intentionally does **not** include a Control Plane service. Deploy or connect a compatible endpoint separately.

公开客户端刻意**不包含** Control Plane 服务；请单独部署或接入兼容端点。

### 4. Use the host plugins / 使用宿主插件

Marketplace manifests are included for Codex and Claude Code under `plugins/`. Once installed, use the host-facing commands such as:

```text
/spinal-plug:connect
/spinal-plug:share
/spinal-plug:sync
/spinal-plug:boot
```

## Project Status / 项目状态

The current release focuses on project-scoped durable memory, native host projections, local-first storage, and selective synchronization. `Mind Core`, `Mind Capsule`, `Incarnation`, and richer work-state handoff are intentionally modeled as extensible runtime concepts rather than promises of identical agent behavior.

当前版本聚焦项目级持久记忆、宿主原生投影、本地优先存储和选择性同步。`Mind Core`、`Mind Capsule`、`Incarnation` 与更完整的工作交接已保留扩展方向，但不承诺不同模型会产生完全相同的行为。

## Development / 开发

```bash
pnpm test
pnpm typecheck
```

---

**SPINAL-PLUG**
*Memory fidelity. Project continuity. Many capable hosts.*
