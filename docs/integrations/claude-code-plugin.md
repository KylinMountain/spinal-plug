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
| `PostToolUse` | 仅匹配写类工具(`Write/Edit/MultiEdit/NotebookEdit`);hook 脚本先对 payload 做路径预筛,只有落在项目原生记忆目录(`~/.claude/projects/<项目>/memory/`)内的写入才调用 CLI,触发原生主题的幂等导入与发布(有端点时)——Claude 自己的后台提取写完主题文件即同步,普通代码编辑零进程开销。 |
| `Stop` | 幂等导入并发布已完成的原生主题文件;若项目既无 active 记忆也无待审候选(空记忆室),注入一次 `<spinal-plug_memory_nudge>`(`decision: "block"`),引导宿主从当前会话生成最多 3 条事实并以 `remember --candidate` 落为待审候选——每个会话最多提醒一次(需 payload 带 `session_id`),一旦有可审阅内容即永久停止。 |
| `SessionEnd` | 会话结束时最后执行一次原生主题导入与发布。 |
| `/spinal-plug:connect` | 在用户明确要求后,创建当前项目与 Spinal Plug Project Space 的绑定。 |
| `/spinal-plug:archive` | 为非 Git 工作目录创建一个命名存档。 |
| `/spinal-plug:general` | 将当前目录绑定到用户级 General Space。 |
| `/spinal-plug:link` | 将当前目录绑定到已有 Space ID。 |
| `/spinal-plug:status` | 查看本地记忆与 Outbox 状态。 |
| `/spinal-plug:share` | 将当前 Claude Code 项目的原生 Auto Memory 主题文件导入并发布到 Spinal Plug Control Plane;空记忆室时从当前会话生成首批记忆(用户驱动,落 active)。 |
| `/spinal-plug:sync` | 下载并合并中心记忆,并投影到 Claude Code 原生 Auto Memory。 |
| `/spinal-plug:boot` | 展示当前 Project Space 的 Mind Core 加载状态。 |
| `/spinal-plug:handoff` | 保存 Project Checkpoint(已完成、决策、待办、阻塞、下一步),供另一个 linked Agent 接力;不写入长期记忆。 |

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

默认**本地优先**：不配置 `SPINAL_PLUG_SYNC_URL` 时，发布会先尝试本机开发中心 `http://127.0.0.1:8787`，无人应答（或被拒绝）则静默留在本地模式——所有记忆操作照常可用，事件留在 Outbox 待后续补发，全程无需认证。需要跨设备/跨 Agent 同步时才显式启动开发中心或指向兼容端点：

```bash
spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787
export SPINAL_PLUG_SYNC_URL="http://127.0.0.1:8787"
```

本地服务没有认证、ACL 或 TLS，仅用于当前设备验证，不能暴露到公网。

本地 SQLite 是设备上的私有缓存和 Outbox。同步协议上传的是带幂等键的记忆事件，下载的是中心物化的快照；不会上传数据库文件。`/spinal-plug:sync` 会在本机将当前 Space 的结果投影为 Claude Code Auto Memory 中受 Spinal Plug 管理的 `spinal-plug-synced.md`，并仅维护 `MEMORY.md` 内带标识的索引块。

## 后续升级

`/spinal-plug:share` 使用只读 Claude Auto Memory Importer：扫描当前项目的主题文件，为每个来源生成稳定 ID 后创建或更新 Spinal Plug 记忆并发布。不会读取完整会话 transcript，不会导入 `MEMORY.md` 索引；疑似 API Key 或私钥内容会被跳过。导入器会跳过 Spinal Plug 受控的 `spinal-plug-*` 文件，避免同步投影被再次上传。

Claude 原生 Auto Memory 的后台提取不是 Hook 可控的同步调用。Spinal Plug 在四个边界同步已完成的原生主题文件：`PostToolUse`(写入记忆目录即热同步)、`SessionStart`、`UserPromptSubmit`、`Stop`/`SessionEnd`。中心服务离线时宿主不会被阻塞，下一边界幂等重试。需要立即上传当前项目记忆时，使用 `/spinal-plug:share`。

手动记忆命令采用命名参数(flag 在文本之前，记忆文本永远原文保存):`spinal-plug share <db> <dir> <kind> [--url <url>] [--device-id <id>] [--key <semantic-key>] <text>`;`remember` 的 `--candidate` 把事实落为待审候选，同一事实重复 staging 会去重。

分享前先运行 `spinal-plug keys <db> <dir>` 读取本 Space 的语义键注册表（键 + 示例陈述）：已有键能覆盖时通过 `--key` 复用——确定性编译器按键合并、替代与判冲突；都不合适才新建 kebab-case 键（可带 `namespace:` 前缀）。自由命名会在不同宿主间发散，对注册表做分类是跨设备记忆一致的关键。
