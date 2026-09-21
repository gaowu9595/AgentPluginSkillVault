---
name: database-review
description: Use when 概要设计新增或调整数据库表、持久化字段、约束、索引、事务、资金/Credit/账单/库存/配额模型，或数据库审核出现反复全量重跑、耗时失控、Agent 超时/402、修复后需要判断增量回归范围的情况。
---

# database-review（数据库设计严格审核）

**参数**：`$ARGUMENTS = <概要设计或项目目录> [--full|--incremental] [--fix]`

**REQUIRED BACKGROUND:** 先完整读取 `shared/design-session-engine.md`。

## 核心原则

首次审核必须严格覆盖，后续修订必须按影响增量验证。严格不等于重复：已由可核验基线证明且本次未变化的表、字段和不变量，继承结论；不得反复交给 Agent 重读。

机器契约：`review-mode: full/delta/deterministic-only`。

## 不降低的门禁

- 先用 DDL、migration、ORM/Entity、DAL、Service 和测试建立代码事实。
- 首次覆盖必须达到表 100%、新增/修改字段 100%，并完成删除挑战、查询/索引、事务、幂等、对账、迁移和冷读。
- 正式 `passed` 始终要求 P0=0、P1=0、所需独立 Agent 完成、原始输出可核验、无阻塞假设。
- 主 Agent 逐条裁决发现；不得用投票、平均分或 P2 掩盖 P0/P1。
- 资金/Credit/账单等敏感设计必须有稳定幂等键、事务/锁顺序、未知结果恢复和可独立重算的对账式。

## 必须加载的资源

1. 始终读取 `references/review-criteria.md`。
2. 生成 full/delta 证据包时读取 `references/evidence-template.md`。
3. 启动 Agent 前读取 `references/reviewer-prompts.md`，并只选择当前模式需要的提示词。
4. 输出报告时读取 `references/report-template.md`。
5. 仅验证 Skill 时读取 `references/fixtures/cases.md`。

## 第一步：先判定模式和成本

在读取大文件或启动 Agent 前，必须输出：

```text
review_mode: full/delta/deterministic-only
baseline: none/<report + hashes>
changed_tables: N
changed_fields: N
changed_invariants: N
agents: none/data-model/money-engineering/both
files_to_read: N
auto_repair_round: 0/1
```

### 完整覆盖基线 complete-baseline

同时满足以下条件即可作为增量基线，**不要求上轮必须 passed**：

1. 设计 hash、代码基线和证据包 hash 可复算；
2. 上轮表/字段分母和 100% 覆盖清单存在；
3. 所需 Agent 原始输出存在且 hash 可核验；
4. 上轮 P0/P1/P2 和主 Agent 裁决完整；
5. 本次能生成封闭的变更清单，证明哪些表、字段、不变量和代码证据未变。

规则标识：`failed-baseline-can-delta`。上轮 failed 但覆盖完整时，只复查未解决 P0/P1 及其修订影响，禁止仅因 failed 自动退回 full。

### 模式决策

| 条件 | 模式 |
|---|---|
| 无 complete-baseline、hash/原始输出/覆盖清单缺失 | full |
| 新增/删除/合并/拆分表，或新增/删除/重命名持久化字段 | full |
| 新增资金写入路径、改变跨表原子边界、统一锁序或事实源归属 | full |
| 已有完整基线；局部字段语义、CHECK、索引、函数权限/manifest、恢复细节修订 | delta |
| 只改解释、示例、排版、术语或不改变持久化语义的参数说明 | deterministic-only |
| 变更边界无法证明 | full |

`--incremental` 是请求 delta，不是绕过门禁；不满足 complete-baseline 时说明缺口并转 full。`--full` 显式要求 full。默认 auto 按上表选择。

## 第二步：生成变更影响矩阵

对基线到当前版本逐项分类：

| 变化 | 数据模型 | 资金工程 | 冷读 | 处置 |
|---|---|---|---|---|
| 表/字段集合、事实源、基数、生命周期 | 是 | 视情况 | 是 | full 或数据模型 Agent |
| NULL/CHECK/状态机/唯一约束 | 是 | 涉及资金时是 | 仅语义变化时 | delta |
| 金额、余额、锁、事务、幂等、恢复、迁移、对账 | 视情况 | 是 | 否 | delta 或事务拓扑变化时 full |
| 函数签名、owner、ACL、manifest | 否 | 是 | 否 | delta |
| 纯解释/格式 | 否 | 否 | 主 Agent 定向检查 | deterministic-only |

规则标识：`no-fullstack-agent`。数据库 Skill 不启动全栈 Agent；HTTP、页面和 DTO 由 quality/security 或全栈设计检查处理。

## 第三步：按模式执行

### full

1. 核验相关代码事实并生成完整证据包。
2. 确定性预检覆盖全部变化表/字段、关系、不变量、查询/索引和写入路径。
3. 启动数据模型、工程与资金安全两个隔离只读 Agent。
4. 主 Agent 裁决并在 `--fix` 时修复。
5. 仅在新表、字段业务含义或事实源发生变化时执行独立冷读。

### delta

1. 生成 baseline chain 和 delta change manifest；旧审核产物只读，不覆盖。
2. 继承未变表/字段/查询/不变量的覆盖结论，报告中列出继承分子/分母和来源 hash。
3. 只读取：旧未解决问题、变更片段、受影响证据、相关不变量和最小代码白名单。
4. 只启动影响矩阵命中的 Agent：数据模型、资金工程、两者或零个。
5. Agent 只输出受影响范围；不得重新输出全部逐表逐字段报告。
6. 合并“继承覆盖 + delta 新结论”计算当前总覆盖率。

### deterministic-only

核对 hash、变更清单、链接/表格/SQL 片段和术语一致性；不生成大证据包、不启动 Agent、不使未受影响的 passed 链失效。

## Agent 上下文与失败策略

- full Agent 只能读取证据包白名单；delta Agent 只能读取 delta bundle 白名单。
- 同一轮禁止 Agent 再派生 Agent；数据库审核最多并行两个固定方向。
- `fail-fast-codes: 401/402/403`；quota/payment/auth/permission 或明确额度不足立即返回 `independent_review_unavailable`。
- 规则标识：`no-retry-payment-auth`。上述错误不得重试、等待或改用第三个 Agent。
- 仅瞬时网络/流中断且尚无有效输出时，允许缩小输入后重试一次；第二次失败立即停止。
- 每个 Agent 优先输出全部 P0/P1；P2 最多 10 条，不得隐藏更高级别问题。

## 修复预算与停止规则

- `max-auto-repair-rounds: 1`：一次自动“修复→受影响预检/Agent”后必须停止循环。
- 规则标识：`p2-no-loop`。P2 只登记，不自动修复，不触发新审核轮次。
- 相同设计 hash、代码基线、证据 hash 和 Agent 输入摘要不得重复执行。
- 一轮后仍有 P0/P1：返回 failed；缺业务事实：blocked；Agent 不可用：independent_review_unavailable。
- 继续第二轮必须由用户明确要求，且只处理新增或仍未关闭的 P0/P1。

## 结果与 coding readiness

正式状态保持：`passed / failed / blocked / stale / independent_review_unavailable / not_applicable`。

报告另给 `coding_readiness`：

| 值 | 条件 | 允许范围 |
|---|---|---|
| `ready` | database-review passed | 按其他设计门禁执行 |
| `conditional` | complete-baseline 无未解决 P0；delta 确定性预检通过；仅 Agent 不可用或存在明确外部上线门禁 | feature flag、Mock、迁移脚本、单元/集成测试；禁止生产启用 |
| `not_ready` | 有 P0、未解决 P1、证据缺口、覆盖/变更边界不完整 | 不进入实现 |

`conditional` 不是 `passed`，不得写 passed marker、执行生产迁移、启用真实资金写、真实外部适配器或生产调度。

## 落盘要求

保存版本化证据包、delta manifest、所需 Agent 原始输出和主报告。报告至少包含：

- review mode 与成本摘要；
- baseline chain 和当前 hashes；
- 继承覆盖、delta 覆盖及合并后的表/字段覆盖率；
- 影响 Agent 选择理由；
- P0/P1/P2 与主 Agent 裁决；
- 自动修复轮次；
- database-review status、coding_readiness 和外部门禁。

只有严格 passed 才写入与当前摘要绑定的 `database-review: passed` marker。

## 禁止事项

1. 禁止把“严格”解释为每次全量重读。
2. 禁止因上轮 failed 而丢弃可核验的完整覆盖基线。
3. 禁止 delta Agent 重读全部设计、全部代码或重新输出 100% 未变字段。
4. 禁止数据库 Skill 启动全栈 Agent或为 P2 递归复审。
5. 禁止在 401/402/403、quota/payment/auth/permission 后等待或重试。
6. 禁止把 conditional 表述成 passed 或 production-ready。
7. 禁止证据不足时猜测需求或把 ASSUMPTION 升级为事实。
