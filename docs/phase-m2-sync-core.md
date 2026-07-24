# M2 同步内核

> 本文记录 M2 同步核心的基础设计；当前实现已扩展到认证控制面、中心编译器、选择性同步、Project Checkpoint 和同源管理控制台。对应决策见 ADR-007 至 ADR-011，以及 [控制台说明](control-plane-console.md)。

当前实现提供传输无关的跨节点同步闭环：

```text
Agent / CLI
  -> SQLite WAL + Outbox
  -> SpinalPlugSyncClient.push()
  -> Central Event Ledger
  -> MemoryCompiler
  -> canonical_memories / memory_disputes
  -> SpinalPlugSyncClient.pull()
  -> 本地事件物化 + Cursor 前移
```

## 协议

`@spinal-plug/protocol` 增加：

- `SyncPushRequest` / `SyncPushResponse`
- `SyncPullRequest` / `SyncPullResponse`
- `SyncFetchRequest` / `SyncFetchResponse`
- `CanonicalMemoryUpdate`
- `ProjectSnapshot`

Push 使用 `eventId` 幂等。重复事件会出现在 `duplicateEventIds`，客户端会安全地将对应 Outbox 项标记为已投递。Pull 使用 `cur:<sequence>` 形式的不透明 cursor，客户端只会在远端事件成功应用到本地 SQLite 后保存新 cursor。

## 当前实现与后续工作

`@spinal-plug/sync-server` 的 `InMemorySyncServer` 是服务端语义实现与测试替身；`PersistentSyncServer` 是当前可重启的本地中心实现。它们共同实现：

- Space 隔离的顺序事件流
- Push 去重
- 分页 Pull
- active memory Snapshot
- tombstone 传播
- `candidate → active / superseded / disputed` 确定性编译
- 来源、置信度、语义键与事件 provenance
- 因果替代、完全重复合并、并发冲突和显式解决

仍保留给后续阶段的能力：

- 基于模型的语义键生成与候选归一化；
- 实时远端通知；
- 完整的上传前 Secret Scanner；
- 多分支任务语义合并。

这些能力将接在 `SyncTransport` 后，而不会改变 Agent Adapter、Project Space 或 SQLite WAL 的写入模型。

## 持久化 HTTP 开发服务

`@spinal-plug/sync-server` 现在提供 `PersistentSyncServer` 与最小 HTTP 封装。它使用独立 SQLite WAL 保存中心事件流，重启服务后仍保留 Project Space 的事件和 Snapshot。

```bash
spinal-plug serve ./data/spinal-plug-central.db 8787
```

客户端使用同一 Space 的本地数据库与设备标识同步：

```bash
spinal-plug sync ./.spinal-plug/spinal-plug.db . http://127.0.0.1:8787 device-macbook
```

当前 HTTP API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/events:push` | 幂等接收一个 Space 的事件批次。 |
| `GET` | `/v1/events:pull` | 按 `space_id`、`device_id`、`cursor` 和 `limit` 拉取增量。 |
| `GET` | `/v1/updates:fetch` | 获取中心编译后的规范更新，供本地预览和选择。 |
| `GET` | `/v1/spaces/:spaceId/snapshot` | 获取当前 active memory 的物化快照。 |
| `GET` | `/v1/spaces/:spaceId/compilation` | 获取 active、candidate、disputed、superseded 与争议详情。 |

`spinal-plug serve` 是本地开发与协议验证服务，默认只监听 `127.0.0.1`，不得直接暴露公网。

正式控制面入口为 `spinal-plug serve-control-plane`，已经实现：

- 账户与用户隔离
- 一次性设备令牌与服务端摘要存储
- 设备注册、列表和撤销
- Project Space `owner / editor / viewer` ACL
- 事件账户与设备来源校验
- 每设备限流
- TLS 配置，以及无 TLS 时强制回环监听

详细安全决策见 [ADR-008](adr/ADR-008-authenticated-control-plane.md)。

## 选择性同步

```bash
spinal-plug fetch ~/.spinal-plug/spinal-plug.db . <url> <device-id>
spinal-plug preview ~/.spinal-plug/spinal-plug.db .
spinal-plug apply-codex ~/.spinal-plug/spinal-plug.db . <update-id>...
```

本地 `sync_inbox` 保存尚未应用的更新。普通更新由用户选择；Tombstone 是必需更新，在 fetch 后立即落地。协议决策见 [ADR-009](adr/ADR-009-fetch-preview-apply-sync.md)。
