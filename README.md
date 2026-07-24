# SPINAL-PLUG

Spinal Plug 是一个面向 Agent 的跨设备项目记忆客户端。它以“记忆脊椎栓、神经链路、联接率”作为运行时界面表达；这些只是系统状态的可视化，不表示生物控制或模型隐藏状态复制。

- `protocol`: v0.1 协议对象与 schema
- `local-node`: 本地 SQLite WAL / Outbox 基础层
- `adapter-sdk`: 统一适配器接口
- `adapter-claude-code`: Claude Code 生命周期与受管原生记忆投影
- `adapter-codex`: Codex 生命周期、候选提取与受限原生记忆投影
- `mcp-server`: MCP Server 骨架
- `cli`: 本地命令行入口

当前版本只覆盖项目记忆同步最小闭环，并为未来的 `Mind Core`、`Mind Capsule`、`Incarnation`、`Work State` 预留协议字段和模块边界。

运行时最小垂直切片现已可用：可创建 `Mind Core`、角色、Mission、Task Graph、Mind Capsule 与 Incarnation，并与项目记忆和 Checkpoint 分离同步。

`spinal-plug boot` 使用固定的 `Memory Core Boot Sequence` 表达加载过程：`Spinal Plug Control Plane`、`Incarnation Link`、`Mind Capsule` 与 `Memory Fidelity` 都对应可验证的本地项目记忆状态；它不表示模型权重、隐藏状态或“意识”被复制。

Spinal Plug 不把宿主原生记忆当作事实源；适配器只能维护各自受保留标识保护的投影，并在宿主升级后通过兼容测试重新验证。

公开客户端通过可替换的 HTTP Sync Transport 对接已部署的同步端点；中心服务与其控制台不包含在本仓库或公开提交中。

Claude Code 与 Codex 插件可通过仓库内的 marketplace manifests 安装。

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
```
