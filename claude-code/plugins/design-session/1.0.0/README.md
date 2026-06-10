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

## 结构

- `skills/` — 每个子命令对应一个 SKILL.md
- `shared/` — 跨子命令共享的核心逻辑（路径约定、分层恢复、变更传播机制等）

## 兼容性

原 `/design-session <项目> <子命令>` 语法仍可使用（通过 `.claude/commands/design-session.md` 兼容入口）。
