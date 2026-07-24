# Claude Code 插件试运行

Spinal Plug 的 Claude Code 集成是一个本地 marketplace 插件，源代码位于：

```text
plugins/spinal-plug-claude/
```

安装后的插件标识为：

```text
spinal-plug@spinal-plug-local
```

## 当前行为

| 生命周期 | 行为 |
| --- | --- |
| `SessionStart` | 从当前项目的 Spinal Plug 本地数据库生成 Project Boot Context。 |
| `UserPromptSubmit` | 根据当前提示生成少量相关项目记忆。 |
| `/spinal-plug:connect` | 在用户明确要求后，创建当前项目与 Spinal Plug Project Space 的绑定。 |
| `/spinal-plug:archive` | 为非 Git 工作目录创建一个命名存档。 |
| `/spinal-plug:general` | 将当前目录绑定到用户级 General Space。 |
| `/spinal-plug:link` | 将当前目录绑定到已有 Space ID。 |
| `/spinal-plug:status` | 查看本地记忆与 Outbox 状态。 |
| `/spinal-plug:share` | 将当前 Claude Code 项目的原生 Auto Memory 主题文件导入并发布到 Spinal Plug Control Plane。 |
| `/spinal-plug:sync` | 下载并合并中心记忆，并投影到 Claude Code 原生 Auto Memory。 |
| `/spinal-plug:boot` | 展示当前 Project Space 的 Mind Core 加载状态。 |

插件不会把 Claude Code 原生 Auto Memory 目录作为事实源，也不在 `Stop` 阶段自动提取整段对话。选择性应用后，Claude Adapter 只维护受 Spinal Plug 标识保护的 `spinal-plug-synced.md` 投影和 `MEMORY.md` 索引块，不会改写用户自己的主题文件。

首次进入未绑定的 Git 项目时，启动 Hook 自动创建 `.spinal-plug/space.json` 和私有本地缓存。项目名称优先取 Git remote 的仓库名，其次取 Git 根目录名；有 remote 时，Space ID 从规范化 remote 稳定派生，使不同设备可识别为同一项目。

首次进入未绑定的非 Git 目录时，Hook 不会替用户选择空间，但会让宿主询问一次：新建存档、使用 General、连接已有存档，或本次不启用。选择后写入同一个 `.spinal-plug/space.json`，因此之后能自动恢复该目录上次使用的 Space。`General` 是用户级通用空间，当前 M1 本地运行时使用固定本地 ID；正式云端版会由认证账户命名空间隔离。

Hook 显示简短的加载状态，`/spinal-plug:boot` 则提供固定的 `Memory Core Boot Sequence`。该体验只表示身份、项目记忆与上下文投影已经加载，不代表复制底层模型权重或隐藏状态。

当前启动术语如下：

| Spinal Plug 表达 | 当前 M0/M2 的实际含义 |
| --- | --- |
| `Memory Fidelity` | 本地稳定视图中已加载的持久记忆引用数；不使用虚假的同步百分比。 |
| `Mind Capsule` | 当前为项目级启动上下文；未来才扩展为身份、角色和任务均可挂载的完整胶囊。 |
| `Incarnation Link` | 当前宿主会话与该项目 Space 的绑定。 |
| `Spinal Plug Control Plane` | 本地节点、事件流和同步服务组成的控制层。 |
| `Memory Core Boot Sequence` | 将项目空间、上下文投影和同步状态装载到当前宿主的固定序列。 |

## 本机试运行配置

默认数据库：

```text
~/.spinal-plug/spinal-plug.db
```

默认开发中心：

```text
http://127.0.0.1:8787
```

启动服务：

```bash
spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787
```

本地服务没有认证、ACL 或 TLS，仅用于当前设备验证，不能暴露到公网。

本地 SQLite 是设备上的私有缓存和 Outbox。同步协议上传的是带幂等键的记忆事件，下载的是中心物化的快照；不会上传数据库文件。`/spinal-plug:sync` 会在本机将当前 Space 的结果投影为 Claude Code Auto Memory 中受 Spinal Plug 管理的 `spinal-plug-synced.md`，并仅维护 `MEMORY.md` 内带标识的索引块。

## 后续升级

`/spinal-plug:share` 使用只读 Claude Auto Memory Importer：扫描当前项目的主题文件，为每个来源生成稳定 ID 后创建或更新 Spinal Plug 记忆并发布。不会读取完整会话 transcript，不会导入 `MEMORY.md` 索引；疑似 API Key 或私钥内容会被跳过。导入器会跳过 Spinal Plug 受控的 `spinal-plug-*` 文件，避免同步投影被再次上传。

Claude 原生 Auto Memory 的后台提取不是 Hook 可控的同步调用。Spinal Plug 会在 `SessionStart`、`UserPromptSubmit` 和 `Stop` 边界扫描已完成的原生主题文件并幂等发布；中心服务暂时离线时，宿主不会被阻塞，下一边界会重试。需要立即上传当前项目记忆时，使用 `/spinal-plug:share`。
