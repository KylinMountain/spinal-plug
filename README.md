# SPINAL-PLUG

> **一个记忆核心，多个可工作的分身。**

Spinal Plug 是面向 AI 编程智能体的跨设备项目记忆客户端。它让项目中真正值得保留的决策、协作习惯和关键背景，在 Claude Code、Codex 等兼容宿主之间流动；它不复制模型权重、隐藏状态或所谓“意识”。

```text
CLAUDE CODE / CODEX                 SPINAL PLUG                    NEXT HOST

项目内完成工作          发布         持久记忆        项目内          加载有界的
形成决策或纠正      ───────────►    同步端点     ─────────►        原生记忆投影
```

English version: [README.en.md](README.en.md)

## 为什么

在另一台设备打开同一项目的 Agent，不应该需要用户重新讲述每一项重要决定；但把所有历史聊天直接塞回上下文，又会带来噪声、过期信息和隐私风险。

Spinal Plug 保持明确边界：

- **加载**：以少量、相关的项目记忆作为启动上下文。
- **工作**：每个宿主在自己的会话和环境中独立工作。
- **回归**：只发布持久信号；其他宿主先预览，再选择是否应用。

目标是项目连续性，而不是无限膨胀的全局 Prompt。

## 使用体验

```text
MEMORY CORE BOOT SEQUENCE

[01/05] Project Space ............ LINKED
[02/05] Incarnation Link ......... BOUND
[03/05] Mind Capsule ............. READY
[04/05] Memory Fidelity .......... AVAILABLE
[05/05] Sync Uplink .............. ONLINE
```

| 术语 | 含义 |
| --- | --- |
| **记忆脊椎栓 / Spinal Plug** | 挂载到兼容 Agent 宿主上的项目记忆链路。 |
| **记忆保真度 / Memory Fidelity** | 当前会话可用的持久记忆引用，不是虚构的同步百分比。 |
| **心智胶囊 / Mind Capsule** | 有界的启动包；后续可扩展为角色与工作状态运行时。 |
| **具身链路 / Incarnation Link** | 当前宿主会话和 Project Space 之间的绑定。 |
| **同步上行链路 / Sync Uplink** | 到兼容同步端点的受控连接。 |

## 它保存什么

Spinal Plug 用于保存那些难以重新发现、并且能跨会话持续产生价值的信息：

- 技术或产品决策及其原因。
- 持续有效的项目规则或工作流纠正。
- 无法直接从仓库推导的项目背景。
- 指向权威外部资料的引用。

它不适合保存密钥、完整对话、瞬时任务进度，或必须重新从代码验证的事实。当前工作进度应通过 checkpoint/handoff 处理，而不是污染长期记忆。

## 选择性同步

接收更新和实际使用更新是两个动作：

```text
Fetch  →  Preview  →  Apply  →  Native projection
获取      预览        选择应用     写入宿主可读投影
```

你可以先看见其他分身产生了什么，再决定是否把它带入当前会话。删除和权限撤销属于安全例外，应优先执行。

## 已接入宿主

| 宿主 | 当前接入方式 |
| --- | --- |
| **Claude Code** | 生命周期 Hook 加载上下文，并维护受管 Auto Memory 投影。 |
| **Codex** | 生命周期 Hook、有界候选提取和保留原生记忆投影。 |
| **未来宿主** | 通过适配器契约与 MCP 接口扩展，无需改变本地记忆模型。 |

Spinal Plug 不取代宿主的原生记忆系统，只维护自身受管投影，不覆盖用户已有记忆。

## 快速开始

### 1. 构建客户端

```bash
pnpm install
pnpm build
pnpm typecheck
```

### 2. 连接项目

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
spinal-plug boot "$HOME/.spinal-plug/spinal-plug.db" .
```

本地 SQLite 数据库是设备私有缓存和 Outbox；同步的是带来源与版本信息的事件，而不是上传整个数据库文件。

### 3. 配置同步端点

```bash
export SPINAL_PLUG_SYNC_URL="https://your-sync-endpoint.example"
export SPINAL_PLUG_DEVICE_ID="device-local"
```

公开客户端刻意**不包含** Control Plane 服务；请单独部署或接入兼容端点。

### 4. 使用宿主插件

Codex 和 Claude Code 的 marketplace manifests 位于 `plugins/`。安装后可使用：

```text
/spinal-plug:connect
/spinal-plug:share
/spinal-plug:sync
/spinal-plug:boot
```

## 项目状态

当前版本聚焦项目级持久记忆、宿主原生投影、本地优先存储和选择性同步。`Mind Core`、`Mind Capsule`、`Incarnation` 与更完整的工作交接已保留扩展方向，但不承诺不同模型会产生完全相同的行为。

## Documentation / 文档

- [Spinal Plug 术语与文案语气](docs/spinal-plug-voice.md)
- [Mind Runtime(Mind Core / Capsule / Incarnation)](docs/mind-runtime.md)
- [M1 本地工作流与 CLI 契约](docs/phase-m1-local-workflow.md)
- [M2 同步内核与边界](docs/phase-m2-sync-core.md)
- [Control Plane 控制台](docs/control-plane-console.md)
- [Claude Code 插件集成](docs/integrations/claude-code-plugin.md)
- [Codex 插件集成](docs/integrations/codex-plugin.md)
- [Claude Code 参考实现观察](docs/research/claude-code-reference-notes.md)

## 开发

```bash
pnpm test
pnpm typecheck
```

---

**SPINAL-PLUG**
*记忆保真度。项目连续性。多个可工作的宿主。*
