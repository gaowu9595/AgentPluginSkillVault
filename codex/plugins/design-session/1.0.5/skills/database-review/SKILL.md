---
name: database-review
description: Use when 数据库设计新增或调整表、字段、约束、索引、持久化语义、事务边界或高完整性状态，尤其是局部改动被反复全量审核、审核耗时失控、模型可能过度设计或需要判断最小回归范围时。
---

# 数据库设计审核

**参数**：`$ARGUMENTS = <设计文档或项目目录> [--quick|--incremental|--full] [--fix]`

**REQUIRED BACKGROUND:** 先完整读取 `shared/design-session-engine.md`。

流程接入：按 `shared/workflow.md` 将本次报告、实际输入指纹、范围和结论登记为 database_gate；旧 database_review 名称只用于迁移。check database 就是本 Skill 的入口，不执行两轮。微型设计的 scope_passed 只对当前封闭变更有效；不适用也需报告、代码证据和原因。此登记不改变下面的风险分级、预算及独立审查要求。

## 核心原则

先证明设计有必要，再证明设计完整。严格审核不等于重复审核，也不等于产出更长的报告。

机器契约：`review-mode: quick/delta/full/deterministic-only`。

## 通用性边界

- Skill 只保存跨项目通用的数据库判断方法，不保存任何项目名、真实表名、真实字段名、业务状态、计算公式或产品规则。
- 项目事实只能在运行时从目标仓库、设计文档和用户确认中读取。
- 回归样例只使用中性虚构对象，不得成为真实审核的默认答案。
- 审核任务不得创建实施计划、需求文档或设计方案。只有用户显式要求修复且修复范围已确认时才能修改目标文件；范围较大时先返回发现，不自动转入计划流程。

规则标识：`review-only-no-plan`。

## 第一步：轻量预检

在读取完整设计、生成证据包或启动 Agent 前，只读取目录索引、已有审核摘要和变更片段，输出：

```text
review_mode: quick/delta/full/deterministic-only
baseline: none/object/complete
changed_tables: N
changed_fields: N
changed_constraints: N
changed_invariants: N
files_to_read: N
agents: 0/1/2
implementation_plan: none
reason: <一句话>
```

预检必须先生成封闭变更清单。无法证明变更边界时返回 `needs_full` 和原因，**不得自动开始 full**。

规则标识：`no-auto-full-escalation`。

## 第二步：先执行最小化门禁

对每张候选表和每个新增或修改字段，先比较以下方案：

1. 复用现有对象；
2. 查询时计算或关联读取；
3. 合并到已有对象；
4. 不持久化，只保留运行日志或外部观测；
5. 新增持久化对象。

每个保留项必须给出：

- 已检索的现有对象及代码证据；
- 独立写入方和读取方；
- 权威来源与生命周期；
- 删除后会失败的具体当前场景；
- 若为复制或派生数据，同步、失败恢复与对账方式；
- 为什么更小方案不能满足要求。

无法证明必要性时记为 P1，并停止对该候选项继续生成大篇幅完整性材料。不得用“便于扩展、方便查询、便于排查、以后可能需要”单独支持落库。

规则标识：`minimality-first`。

## 第三步：按风险选择模式

### `quick`

适用于边界封闭的局部变化，例如少量普通字段、局部约束或索引，且同时满足：

- 不新增、删除、合并或拆分表；
- 不改变权威来源、对象基数或主要生命周期；
- 不改变跨表原子边界、写入方集合、锁顺序或恢复协议；
- 不改变高完整性不变量；
- 受影响对象可以用最小代码白名单核验。

新增字段不再自动触发 full。普通可空字段、非权威投影字段或局部审计字段先做必要性与一致性检查；只有影响上述高风险边界时才升级。

预算：最多读取 8 个文件，不启动 Agent，不生成完整证据包，不写实施计划。输出紧凑的变更对象清单、最小化结论、约束检查和回归建议。

规则标识：`risk-based-new-field`。

### `delta`

适用于已有对象基线且影响范围明确的中等风险变化，包括局部状态语义、类型/NULL/CHECK、并发谓词、恢复细节、迁移细节或高完整性字段调整，但不改变表拓扑和事务拓扑。

预算：默认最多读取 20 个文件；只启动一个被影响方向的 Agent，也可以不启动；只生成 delta bundle，不复制未变化对象的逐字段报告。

上轮审核未通过但覆盖链完整时，仍可继承未变化结论，只复查未关闭 P0/P1 及本次影响。规则标识：`failed-baseline-can-delta`。

### `full`

仅适用于：

- 首次正式认证且当前模型已经稳定；
- 新增、删除、合并或拆分表；
- 改变权威来源、对象基数或主要生命周期；
- 改变写入方集合、跨表原子提交集合、统一锁顺序或未知结果恢复协议；
- 大范围迁移会改变历史数据语义。

full 最多启动两个隔离只读 Agent：数据模型最小化、数据库工程与高完整性。启动前必须向用户展示范围和成本；若本轮只是设计过程中的连续修订，先返回 `needs_full`，待模型稳定后一次性认证，不在每次编辑后自动重跑。

### `deterministic-only`

适用于纯解释、示例、排版、术语或不改变持久化语义的参数说明。只检查 hash、链接、表格和术语，不启动 Agent，不使未受影响结论失效。

## 基线与继承

### 对象基线 `object-baseline`

包含目标对象当前定义、直接读写路径和本次 diff。quick 可以基于对象基线运行，不要求先拥有全库正式认证。

### 完整基线 `complete-baseline`

用于继承正式审核结论，至少包含：设计/代码/证据摘要、表字段分母、覆盖清单、独立输出及主裁决。状态可以是 passed 或 failed。

没有 complete-baseline 不等于必须立刻 full：局部请求可以返回 `scope_passed`；只有需要恢复全局 `passed` 标记时才进行 full。

## Agent 使用规则

- quick 和 deterministic-only 禁止启动 Agent。
- delta 最多一个 Agent，只读取受影响片段和最小代码白名单。
- full 最多两个固定方向，不允许 Agent 再派生 Agent。
- Agent 先审最小性，再审完整性；不得只把候选设计换一种措辞重新证明一遍。
- 相同输入摘要不得重复执行。
- 401/402/403、额度、鉴权或权限失败立即停止，不等待、不切换第三个 Agent。
- 仅瞬时网络中断且没有有效输出时允许缩小输入重试一次。

规则标识：`max-agents-quick-0-delta-1-full-2`。

## 完整性门禁

只有通过最小化门禁的对象才继续检查：

- 类型、精度、单位、NULL、默认值和状态转换；
- 主键、唯一性、外键、基数和删除行为；
- 真实查询与索引双向映射；
- 写入路径、事务控制方、锁顺序、幂等和未知结果恢复；
- 可独立重算的不变量与对账；
- 迁移、回填、兼容、回滚、容量和保留策略；
- DDL、ORM、DAL、Service 与测试的一致性。

正式 `passed` 要求 P0=0、P1=0、最小化门禁通过、覆盖链完整、所需独立 Agent 完成且无阻塞假设。

## 修复预算与停止规则

- `max-auto-repair-rounds: 1`：`--fix` 最多执行一次“修复 → 受影响检查”。
- `p2-no-loop`：P2 只登记，不自动触发新一轮。
- quick 发现范围扩大时返回 `needs_delta` 或 `needs_full`，不自行升级执行。
- delta 发现表拓扑或事务拓扑变化时返回 `needs_full`，不自行扩大上下文。
- 一轮后仍有 P0/P1 时返回 failed；缺少项目事实时返回 blocked。

## 结果

| 状态 | 含义 |
|---|---|
| `scope_passed` | 本次封闭变更范围通过，不声明全局设计已认证 |
| `passed` | 完整数据库设计认证通过 |
| `failed` | 当前范围存在 P0/P1 |
| `blocked` | 缺少必要事实或证据 |
| `needs_delta` | quick 范围不足，需要用户确认增量审核 |
| `needs_full` | 需要用户确认正式全量审核 |
| `stale` | 输入摘要在审核期间变化 |
| `independent_review_unavailable` | 必需的独立审核不可用 |
| `not_applicable` | 没有持久化变化 |

报告另给 `coding_readiness: ready/conditional/not_ready`。`scope_passed` 可以支持本次局部实现，但不能替代项目要求的正式 `passed` 标记。

## 资源加载

1. 始终读取 `references/review-criteria.md`。
2. 仅在 delta/full 时读取 `references/evidence-template.md`。
3. 仅在确定要启动 Agent 后读取 `references/reviewer-prompts.md`。
4. 输出正式报告时读取 `references/report-template.md`。
5. 仅验证 Skill 时读取 `references/fixtures/cases.md`。

## 禁止事项

1. 禁止审核任务自动写实施计划。
2. 禁止把任意新增字段直接等同于 full。
3. 禁止因缺少完整基线而自动开始 full。
4. 禁止先生成全量字段矩阵，再讨论对象是否应存在。
5. 禁止 quick/delta 重读完整设计或全仓代码。
6. 禁止用报告篇幅、字段覆盖率或 Agent 数量代替设计最小性。
7. 禁止将项目业务规则或真实对象固化进 Skill。
