# design-session 插件

工作流入口：[完整分支流程图](shared/workflow-flowchart.md) · [状态、证据与校验用法](shared/workflow.md)。`next/write/check` 共用本地校验器，按适用范围补齐检查，复用有效证据；不需要 LangGraph。

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

- `/design-session:requirements-clarify <项目目录>` — 在系统需求前，根据原始资料和代码先讲清用户旅程，再筛选真正阻塞的产品决策。
- `/design-session:database-review <概要设计或项目> [--quick|--incremental|--full] [--fix]` — 先做最小化门禁，再按变更风险选择快速、增量或完整审核。
- `/design-session:check database <概要设计或项目> [--full|--incremental] [--fix]` — 同一数据库审核工作流的检查入口。
- `/design-session:check design-quality <概要设计> [--baseline=<重构前文档> --attachments=<附件列表>]` — 检查评审主文档体量、长段落、方案选型、链接，以及拆分后的编码合同是否无损。

database-review 强制门禁按适用性启用：有持久化变更必须审核，无变更须有不适用依据。审核采用 `quick / delta / full / deterministic-only` 自动路由。局部字段不再自动 full，审核任务不写实施计划；P2 不触发复审，自动修复最多一轮。

概要设计与安全审查包含通用权限证据门禁：先发现项目事实源，再逐接口说明复用或新增及代码证据；项目提供权限校验命令时必须执行。插件不会预设具体角色、权限码或权限技术栈。

以开头链接的分支流程图为准：数据库、安全检查包含适用性判断；最后核验全部适用证据后才能进入编码。所有阶段状态、证据台账、多仓库基线和审查指纹遵循 `shared/design-session-engine.md`；缺少状态或指纹失效时，不得按文档存在推断完成。

## 结构

- `skills/` — 每个子命令对应一个 SKILL.md
- `shared/` — 跨子命令共享的核心逻辑（路径约定、分层恢复、变更传播机制等）

## 兼容性

原 `/design-session <项目> <子命令>` 语法仍可使用（通过 `.claude/commands/design-session.md` 兼容入口）。
