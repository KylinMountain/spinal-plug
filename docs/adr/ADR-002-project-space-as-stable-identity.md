# ADR-002: 使用 Project Space 作为稳定项目身份

## 状态

Accepted

## 日期

2026-07-23

## 背景

Claude Code 与 Codex 常运行在不同机器、不同目录、不同 worktree。仅依赖本地绝对路径或 Git 根目录无法稳定识别“这是同一个项目空间”。

## 决策

定义 `ProjectSpace` 作为同步与召回的稳定命名空间：

- `space_id` 是全局稳定主键。
- `type` 在 v0.1 仅实现 `project`。
- `repository` 只作为辅助定位，不等同于 `space_id`。
- 本地允许通过 `.spinal-plug/space.json` 固化绑定关系。

## 结果

优点：

- 跨设备与跨宿主识别稳定。
- 后续可自然扩展到非 Git 工作空间、多仓库空间或个人空间。

代价：

- 需要一层显式初始化或绑定流程。
