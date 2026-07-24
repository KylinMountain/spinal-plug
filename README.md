# Mind Palace

Mind Palace 是一个面向 Agent 的跨设备项目记忆层。当前仓库实现 M0/M1 启动骨架：

- `protocol`: v0.1 协议对象与 schema
- `local-node`: 本地 SQLite WAL / Outbox 基础层
- `adapter-sdk`: 统一适配器接口
- `adapter-claude-code`: Claude Code 生命周期与受管原生记忆投影
- `adapter-codex`: Codex 生命周期、候选提取与受限原生记忆投影
- `mcp-server`: MCP Server 骨架
- `cli`: 本地命令行入口
- `sync-server`: M2 传输无关的权威同步内核

当前版本只覆盖项目记忆同步最小闭环，并为未来的 `Mind Core`、`Mind Capsule`、`Incarnation`、`Work State` 预留协议字段和模块边界。

`mind-palace boot` 使用固定的 `Memory Core Boot Sequence` 表达加载过程：`Mind Palace Control Plane`、`Incarnation Link`、`Mind Capsule` 与 `Memory Fidelity` 都对应可验证的本地项目记忆状态；它不表示模型权重、隐藏状态或“意识”被复制。

Claude Code 本地参考实现的同步、Hook 与后台记忆整理观察见 [docs/research/claude-code-reference-notes.md](docs/research/claude-code-reference-notes.md)。Mind Palace 不把宿主原生记忆当作事实源；适配器只能维护各自受保留标识保护的投影，并在宿主升级后通过兼容测试重新验证。

可运行的 M1 本地工作流、CLI 示例和 Hook 调用契约见 [docs/phase-m1-local-workflow.md](docs/phase-m1-local-workflow.md)。

M2 已实现可替换的同步内核与两节点验证，当前边界见 [docs/phase-m2-sync-core.md](docs/phase-m2-sync-core.md)。

本地协议验证可运行 `mind-palace serve ./data/mind-palace-central.db` 启动无认证、仅回环监听的同步服务。认证控制面使用 `mind-palace serve-control-plane`，提供账户、设备、ACL、撤销、限流和同源控制台，见 [docs/control-plane-console.md](docs/control-plane-console.md)。

Claude Code 本机插件已实现为可安装的 local marketplace 插件，安装和试运行边界见 [docs/integrations/claude-code-plugin.md](docs/integrations/claude-code-plugin.md)。

## 开发

```bash
pnpm install
pnpm build
pnpm typecheck
```

## 包结构

```text
packages/
  protocol/
  local-node/
  adapter-sdk/
  adapter-claude-code/
  adapter-codex/
  mcp-server/
  cli/
docs/adr/
```
