---
name: help
description: 列出 design-session 插件的所有可用子命令及简要说明。用法：/design-session:help
---

# design-session 子命令列表

输出以下表格给用户：

| 子命令 | 用法 | 说明 |
|--------|------|------|
| `/design-session:resume` | `<项目目录>` | 恢复项目设计上下文（默认操作） |
| `/design-session:save` | `<项目目录>` | 保存当前对话要点到持久化文件 |
| `/design-session:analyze` | `<项目目录>` | 分析资料目录，逐个读取并落盘摘要 |
| `/design-session:record` | `<项目目录> [--propagate]` | 记录本轮变更/决策到变更追踪 |
| `/design-session:change` | `<项目目录> "变更描述" [--scope=...]` | 显式触发设计变更传播 |
| `/design-session:check` | `consistency/quality/design-quality/database/security/<规范文档>` | 设计文档规范检查（一致性/合规/需求质量/概设可读性/数据库/安全） |
| `/design-session:database-review` | `<概要设计或项目> [--incremental] [--fix]` | 逐表逐字段严格审核数据库设计，P0/P1 清零后才能通过 |
| `/design-session:write-spec` | `<项目目录>` | 系统需求编写（含交互覆盖度自检） |
| `/design-session:status` | `<项目目录>` | 快速查看项目当前进展 |
| `/design-session:next` | `<项目目录>` | 给出最该执行的下一步行动建议 |
| `/design-session:audit` | `<项目目录>` | 变更追踪审计，发现遗漏变更 |
| `/design-session:archive` | `<项目目录> <iter-id>` | 冻结当前迭代的资料/摘要/决策 |
| `/design-session:write` | `<项目目录>` | 进入概要设计编写模式 |

## 设计阶段总览

```
阶段1 需求理解  ──→  阶段2 顶层设计  ──→  阶段3 系统需求  ──→  阶段4 概要设计  ──→  阶段5 编码  ──→  阶段6 审查
   :analyze          :resume/:save        :write-spec           :write              AI编码工作流    /diff-review
                                           :check quality        :check consistency
```

## 典型工作流

```
项目启动 → :analyze → 需求理解
写系统需求 → :write-spec → 按流程编写（含交互覆盖度自检）
写概要设计 → :write → design-quality → database-review → security → 设计完成
日常推进 → :resume → 继续设计 → :record → 记录变更 → :save → 保存进展
迭代收尾 → :archive <iter-id> → 冻结归档
不确定   → :next → 看建议
```
