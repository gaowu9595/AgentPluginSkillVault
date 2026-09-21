# 数据库审核报告模板

机器标识：`template-kind: database-review-report-v3`、`scope-result-supported`。

## 0. 模式与成本

| 项目 | 内容 |
|---|---|
| review mode | quick/delta/full/deterministic-only |
| baseline | none/object/complete + 摘要 |
| changed tables/fields/constraints/invariants | N/N/N/N |
| files read | N + 白名单 |
| selected agents | 0/1/2 + 理由 |
| implementation plan | none |
| automatic repair rounds | 0/1 |

## 1. 最小化结论

| 对象 | 复用 | 计算/关联 | 合并 | 不持久化 | 删除后具体失败 | 最终结论 | 证据 |
|---|---|---|---|---|---|---|---|

结论只能是：`保留 / 合并 / 扩展现有对象 / 删除 / 证据不足阻塞`。

## 2. 受影响范围覆盖

| 对象类型 | 基线覆盖 | 未变化 | 本轮覆盖 | 合并后覆盖 | 摘要 |
|---|---:|---:|---:|---:|---|
| 表 | | | | | |
| 字段 | | | | | |
| 查询/索引 | | | | | |
| 写入路径/不变量 | | | | | |

quick/delta 必须列出受影响对象名称，不得复制未变化对象的逐字段报告。

## 3. 问题与裁决

```text
问题 ID：DBR-001
级别：P0/P1/P2
来源：确定性检查/数据模型 Agent/数据库工程 Agent
位置：设计或代码精确位置
证据：REQ-FACT/CODE-FACT/DECISION/ASSUMPTION
问题：
被破坏的不变量：
最小修正：
主 Agent 裁决：接受/拒绝/降级/阻塞
回归范围：quick/delta/full
```

## 4. 关系、查询与写入结论

| 类别 | 对象或路径 | 结论 | 依据 | 剩余风险 |
|---|---|---|---|---|

至少覆盖本轮命中的关系/生命周期、查询/索引、事务/锁、幂等/恢复、不变量、迁移和实现一致性。

## 5. Agent 与主 Agent 裁决

| Agent | 输入摘要 | 原始输出摘要 | 发现 | 主 Agent 裁决 |
|---|---|---|---|---|

未启动 Agent 时写明模式规则，不得为了填表额外启动。

## 6. 最终结论

| 项目 | 结果 |
|---|---|
| P0/P1/P2 | N/N/N |
| 最小化门禁 | 通过/未通过 |
| 当前范围覆盖 | 分子/分母 |
| database-review status | scope_passed/passed/failed/blocked/needs_delta/needs_full/stale/independent_review_unavailable/not_applicable |
| coding_readiness | ready/conditional/not_ready |
| 允许范围 | |
| 外部门禁 | |

`scope_passed` 只证明封闭变更范围；`passed` 才代表完整认证。输入摘要变化后相关结论变为 stale。
