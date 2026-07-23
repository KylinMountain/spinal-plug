# M2 同步内核

当前实现提供传输无关的跨节点同步闭环：

```text
Agent / CLI
  -> SQLite WAL + Outbox
  -> MindPalaceSyncClient.push()
  -> Central Event Ledger
  -> MemoryCompiler
  -> canonical_memories / memory_disputes
  -> MindPalaceSyncClient.pull()
  -> 本地事件物化 + Cursor 前移
```

## 协议

`@mind-palace/protocol` 增加：

- `SyncPushRequest` / `SyncPushResponse`
- `SyncPullRequest` / `SyncPullResponse`
- `SyncFetchRequest` / `SyncFetchResponse`
- `CanonicalMemoryUpdate`
- `ProjectSnapshot`

Push 使用 `eventId` 幂等。重复事件会出现在 `duplicateEventIds`，客户端会安全地将对应 Outbox 项标记为已投递。Pull 使用 `cur:<sequence>` 形式的不透明 cursor，客户端只会在远端事件成功应用到本地 SQLite 后保存新 cursor。

## 当前实现与后续工作

`@mind-palace/sync-server` 的 `InMemorySyncServer` 是服务端语义实现与测试替身；`PersistentSyncServer` 是当前可重启的本地中心实现。它们共同实现：

- Space 隔离的顺序事件流
- Push 去重
- 分页 Pull
- active memory Snapshot
- tombstone 传播
- `candidate → active / superseded / disputed` 确定性编译
- 来源、置信度、语义键与事件 provenance
- 因果替代、完全重复合并、并发冲突和显式解决

尚未实现：

- 自动语义键生成和基于模型的候选归一化
- 实时通知、重试策略和 Secret Scanner

这些能力将接在 `SyncTransport` 后，而不会改变 Agent Adapter、Project Space 或 SQLite WAL 的写入模型。

## 持久化 HTTP 开发服务

`@mind-palace/sync-server` 现在提供 `PersistentSyncServer` 与最小 HTTP 封装。它使用独立 SQLite WAL 保存中心事件流，重启服务后仍保留 Project Space 的事件和 Snapshot。

```bash
mind-palace serve ./data/mind-palace-central.db 8787
```

客户端使用同一 Space 的本地数据库与设备标识同步：

```bash
mind-palace sync ./.mind-palace/mind-palace.db . http://127.0.0.1:8787 device-macbook
```

当前 HTTP API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/events:push` | 幂等接收一个 Space 的事件批次。 |
| `GET` | `/v1/events:pull` | 按 `space_id`、`device_id`、`cursor` 和 `limit` 拉取增量。 |
| `GET` | `/v1/updates:fetch` | 获取中心编译后的规范更新，供本地预览和选择。 |
| `GET` | `/v1/spaces/:spaceId/snapshot` | 获取当前 active memory 的物化快照。 |
| `GET` | `/v1/spaces/:spaceId/compilation` | 获取 active、candidate、disputed、superseded 与争议详情。 |

`mind-palace serve` 是本地开发与协议验证服务，默认只监听 `127.0.0.1`，不得直接暴露公网。

正式控制面入口为 `mind-palace serve-control-plane`，已经实现：

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
mind-palace fetch ~/.mind-palace/mind-palace.db . <url> <device-id>
mind-palace preview ~/.mind-palace/mind-palace.db .
mind-palace apply-codex ~/.mind-palace/mind-palace.db . <update-id>...
```

本地 `sync_inbox` 保存尚未应用的更新。普通更新由用户选择；Tombstone 是必需更新，在 fetch 后立即落地。协议决策见 [ADR-009](adr/ADR-009-fetch-preview-apply-sync.md)。
