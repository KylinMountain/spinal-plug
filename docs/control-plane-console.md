# Spinal Plug Control Plane Console

认证控制面启动后，访问同源地址：

```text
http://127.0.0.1:<port>/console
```

输入当前设备凭据的 `mpd_...` token 后，控制台只展示该设备用户拥有 `viewer` 及以上权限的 Project Space。

## 可见信息

- Project Space 与已链接设备。
- `active` 规范记忆、低置信度候选和未解决冲突。
- tombstone 后的删除记录。
- 最新 Project Checkpoint，包括未完成任务、阻塞和下一步。
- 事件时间线，包含来源宿主、设备和创建时间。

控制台使用同源 Control Plane API，所有数据请求都携带设备 Bearer token，并受账户隔离和 Space ACL 约束。它不读取本地 SQLite 缓存，也不会展示用户无权访问的项目。

## 本地启动

```bash
export SPINAL_PLUG_BOOTSTRAP_TOKEN="choose-a-long-random-value"
spinal-plug serve-control-plane "$HOME/.spinal-plug/control-plane.db" 8787
```

纯 HTTP 仅允许 loopback listener。需要非本机监听时，必须设置 `SPINAL_PLUG_TLS_CERT` 与 `SPINAL_PLUG_TLS_KEY`。

## 3D Memory Palace(`/palace`)

Control Plane 服务器还在 `/palace` 提供 3D Memory Palace:一个 Three.js 展厅,把当前 Space 的规范记忆渲染为可漫游的展品——每种 memory kind 对应不同几何体,记忆状态(active/candidate/disputed/tombstone)对应不同光照处理,展品尺寸随置信度变化。数据来自同源 `/v1/spaces/:id/snapshot` 与 compilation API(30s 轮询),访问控制与 `/console` 一致。

静态资源由 `packages/sync-server/palace/` 提供,安全边界:仅服务扩展名白名单内的文件;拒绝点路径段与符号链接逃逸(realpath 双重校验);按客户端 IP 限流;`HEAD` 支持、其他方法 405。该目录已纳入版本控制,干净检出可直接通过测试。
