# ADR-006: 先实现同步内核，再接入 HTTP 与认证

## 状态

Superseded by ADR-007 and ADR-008

## 日期

2026-07-23

## 背景

M2 需要解决跨设备的 Event Push、Cursor Pull、Snapshot 与 tombstone 传播。若同步排序、幂等和本地应用语义直接分散到 HTTP handler、OAuth middleware 与设备注册逻辑中，就难以做跨节点测试，也会使后续云端存储替换成本过高。

## 决策

- `SyncTransport` 是本地节点依赖的唯一同步接口，提供 `push` 与 `pull`。
- `SpinalPlugSyncClient` 负责 Outbox 推送、远端事件应用和 cursor 提交。
- 最初由 `InMemorySyncServer` 实现权威服务端语义，用于协议测试和本地开发；它按 Project Space 单调排列事件，并以全局 `eventId` 去重。
- `ProjectSnapshot` 是事件流的只读物化视图，仅包含 active MemoryRecord；删除仍由事件流中的 tombstone 保留。
- 后续实现由持久化中心、账户/设备认证、Space ACL、TLS 约束和限流替代，详见 ADR-007、ADR-008。

## 结果

优点：

- 可以在不依赖网络或账户系统的情况下验证两设备同步。
- 传输实现可从内存替换为 HTTP，而不改本地 WAL 或 Adapter。
- cursor 仅在本地成功应用远端事件后推进，降低丢失事件风险。

代价：

- 此 ADR 保留为演进记录；当前中心已持久化事件与编译结果，并支持 `candidate`、`active`、`superseded` 与 `disputed`。
