# design-session 插件

设计会话管理 — 覆盖"需求理解 → 设计推进 → 上下文持久化"的完整设计生命周期。

## 安装

本插件为项目级本地插件，位于 `.claude/plugins/design-session/`。

启用方式：在 `~/.claude/settings.json` 的 `enabledPlugins` 中添加：

```json
{
  "enabledPlugins": {
    "design-session": true
  }
}
```

## 子命令列表

使用 `/design-session:help` 查看所有可用子命令。

- `/design-session:database-review <概要设计或项目> [--full|--incremental] [--fix]` — 首次逐表逐字段严格审核；有完整覆盖基线后按变更影响增量复核。
- `/design-session:check database <概要设计或项目> [--full|--incremental] [--fix]` — 同一数据库审核工作流的检查入口。
- `/design-session:check design-quality <概要设计> [--baseline=<重构前文档> --attachments=<附件列表>]` — 检查评审主文档体量、长段落、方案选型、链接，以及拆分后的编码合同是否无损。

数据库审核采用 `full / delta / deterministic-only` 自动路由。P2 不触发复审；自动修复最多一轮；Agent 401/402/403 或 payment/quota/auth/permission 错误立即停止，不做无效等待。

```text
概要设计 -> design-quality 可读性门禁 -> database-review 强制门禁 -> security -> 编码
```

## 结构

- `skills/` — 每个子命令对应一个 SKILL.md
- `shared/` — 跨子命令共享的核心逻辑（路径约定、分层恢复、变更传播机制等）

## 兼容性

原 `/design-session <项目> <子命令>` 语法仍可使用（通过 `.claude/commands/design-session.md` 兼容入口）。
