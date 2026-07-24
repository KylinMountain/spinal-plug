# ADR-008: 云端同步使用设备凭证与 Space ACL

## 状态

Accepted

## 日期

2026-07-23

## 决策

- 账户、用户、设备、Project Space 与成员角色由 Control Plane 独立维护。
- 设备令牌使用 256-bit 随机值，只在创建时返回一次；服务端只保存 SHA-256 摘要。
- 每次同步请求都验证 Bearer 设备令牌、设备状态、请求 `deviceId`、事件 `actor.deviceId` 与事件 `accountId`。
- Space 角色为 `owner / editor / viewer`。读取需要 viewer，写入事件需要 editor，成员管理需要 owner。
- 撤销设备后令牌立即失效。
- 每个设备使用固定窗口限流；默认每分钟 120 次请求。
- 无 TLS 的 Control Plane 只允许监听 `127.0.0.1`、`::1` 或 `localhost`。非回环部署必须提供 TLS key/certificate。
- `spinal-plug serve` 保留为无认证本地协议演示；正式服务使用 `spinal-plug serve-control-plane`。

## 运行

```bash
export SPINAL_PLUG_BOOTSTRAP_TOKEN="<operator-secret>"
export SPINAL_PLUG_TLS_CERT="/path/to/fullchain.pem"
export SPINAL_PLUG_TLS_KEY="/path/to/private-key.pem"
export SPINAL_PLUG_LISTEN_HOST="0.0.0.0"

spinal-plug serve-control-plane ./data/control-plane.db 8787
```

本地客户端设置：

```bash
export SPINAL_PLUG_ACCOUNT_ID="acc_..."
export SPINAL_PLUG_DEVICE_ID="dev_..."
export SPINAL_PLUG_DEVICE_TOKEN="mpd_..."
```

## 结果

中心事件账本不再以 `spaceId` 作为唯一安全边界。即使两个账户使用相同或可猜测的 Space ID，认证主体也只能访问本账户且已授权的空间。
