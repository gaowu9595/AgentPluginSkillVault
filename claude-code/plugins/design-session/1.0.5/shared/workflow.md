# 流程规则与使用方法

[查看完整分支流程图](workflow-flowchart.md)。流程定义唯一来源是 `workflow.json`；`next`、`write` 完成检查、`check` 无参数路由共同调用 `scripts/workflow_gate.py`。不需要 LangGraph 或新增常驻进程。

## 保存在哪里

- 插件保存通用流程、脚本和图，不保存某个项目的业务规则。
- 项目保存 `.ai/workflow-state.json`：当前迭代/变更范围、文档类型、每项结果、审核时间、报告路径、输入与报告的 SHA-256。
- `context.md` 保存人可读摘要和状态文件指针，不再是“可编码”的唯一判断依据。多迭代并行用 `--state .ai/workflow-state-<迭代>.json`；切换迭代先归档原状态。
- 主 Agent 串行登记状态；独立审查 Agent 只输出报告，避免覆盖彼此记录。状态写入中断导致 JSON 损坏时校验会失败，应从已有报告恢复。

## 每个检查负责什么

| 统一名称 | 必需证据 | 哪个步骤登记 |
|---|---|---|
| input_gate | 原始资料清单、摘要、资料完整性结论 | analyze |
| clarification_gate | 用户旅程和已确认决策、产品 P0 关闭依据 | requirements-clarify |
| spec_gate | 系统需求、覆盖自检、用户确认或已授权且明确记录的兜底方案 | write-spec |
| design_gate | 当前范围的设计主文档/附件和编写完成记录，仅代表已有待审设计，不代表可编码 | write / write-overall |
| template_gate | 对选定模板的检查结果；概设附可读性脚本成功输出 | write 自检 / check design-quality |
| database_gate | 按 database-review 的风险范围审核；或有代码依据的不适用结论 | write 自检 / check database |
| security_gate | 安全/权限事实源及审核报告；或安全边界不变的不适用依据 | write 自检 / check security |
| content_gate | 当前范围的需求覆盖、旅程、前后端/外部契约、测试及跨文档一致性结论；无未关闭 P0/P1 | write 自检 / check consistency |

content_gate的接口证据使用 `skills/write/references/design-guide.md` 的核对表及 `skills/write/references/interface-review.md` 的执行规则：先核对当前业务用途与复用缺口，按风险下钻实际调用/查询规则，逐字段说明来源、具体消费者、删除影响和兼容取舍，最后复述正常/关键失败流程并核验Schema及详细定义位置。公共字段只审一次；原样复用检查本次使用面；纯排版只核验语义和引用。不能只登记一句“已精简”。机器校验证明格式及指纹，不能替代必要性/可读性/语义判断。此项并入原content_gate，不新增门禁、状态文件或固定Agent轮次。

图中design_gate之前的接口分支是write内部步骤：涉及接口变化才执行“来源与复用 → 业务流程 → 字段取舍 → 理由核对”，通过后定稿；证据不足回到受影响步骤。具体判据见上述规则文件。无接口变化走原模板流程。next复用已有等价证据；插件升级本身不使全项目重审，缺什么只补什么，不用新hash冒充审核。

`check quality` 是额外的需求评分，不因本流程升级强制增加。`check consistency` 若只检查了名称一致性，不能独自通过 content_gate；还须结合 write 的覆盖自检。同一份审核记录可以支撑多项，只要各项结论与输入范围清楚，不重复做审查。

数据库适用性包括字段、ORM/DAL、约束、索引、持久化语义、事务、幂等和高完整性状态；不能只搜索 CREATE TABLE。安全适用性包括用户/服务接口、后台任务、外部数据、敏感信息、权限及信任边界；不能仅因没有前端页面就跳过。

微型设计沿用微型模板与轻量自检，不强套完整概设章节；template_gate 记录微型模板自检。只有微型设计当前封闭范围的 database_gate 允许 `scope_passed`，报告必须已覆盖整个当前变更范围；它不代表项目全局认证。概设/总设要求正式通过，不改变数据库 Skill 的 quick/delta/full 选择和预算。

## 运行示例

命令中的 `<插件根>` 是包含 `shared/` 的目录。Windows 可用 `python`，其他环境按实际使用 `python3`。脚本仅用 Python 标准库。

```text
python <插件根>/shared/scripts/workflow_gate.py init <项目> --scope iteration-x
python <插件根>/shared/scripts/workflow_gate.py evaluate <项目>
```

先完成真实审核、保存报告，再登记。例如模板检查已成功运行：

```text
python <插件根>/shared/scripts/workflow_gate.py record <项目> --gate template_gate --result passed --input 架构设计/概要设计.md --input 架构设计/编码附件.md --report .ai/evidence/模板检查.md
```

`--input` 可重复，支持项目相对路径或明确的绝对路径。登记的是审核实际覆盖的资料、代码、设计和已确认决策；不要仅登记报告自己。对于会新增/删除文件的源码范围，可登记较小的目录；目录会比较文件集合和内容，忽略 `.git/node_modules/__pycache__`。不要登记整个项目目录（包含状态/报告会自我失效），也不要用巨大的目录代替范围分析。

`--result` 支持 passed/failed/blocked/scope_passed/not_applicable；不适用必须同时提供 `--reason`、输入和报告。未记录的检查为 unknown。`blockers` 保存当前未关闭的 P0/P1 简述，结论报告需同步；可选 P2 不阻塞。

退出码：`0` = 当前范围所有适用项通过；`1` = 有缺项、失败、过期或阻塞；`2` = 配置/状态/文件操作错误。evaluate 只读，输出 JSON 中有逐项原因和 `next_action`。CI 可以直接依据退出码阻止下一步，报告中的文字不会被当作命令执行。

## 复用与变更

1. 先 evaluate，查看哪些证据仍有效；不因未调用某个子命令就重审已有有效结论。
2. 缺状态时先查已有报告，核对结论、范围和当时输入指纹；一致则登记。仅有 ready、文件存在或 HTML passed 标记不足以迁移。旧报告未留指纹时不能给旧结论盖新指纹；对最小必要范围重新核验，再记录本次证据。
3. 旧 JSON 名称 database_review/security_review 可只读兼容；新写入统一用 database_gate/security_gate。两套记录冲突会阻塞，核验后保留统一名称，不静默择优。
4. 输入/报告变化只使引用它的检查过期。各门禁必须登记完整的相关输入：例如安全审查包含接口/权限设计及权限事实源，内容检查包含需求和设计。输入清单之外的变化无法自动识别，发现范围扩大必须更新清单并复查。
5. 过期不等于全部推倒重来。仅复查受影响结论；数据库仍按现有 Skill 分级，check database 就是 database-review，不执行两遍。
6. 修复完成再 evaluate；只有 ready=true 才输出当前范围可进入编码。它不代表代码已实现、联调通过或生产发布获准。

校验器核查记录完整性和指纹新鲜度，不能证明人工/AI 审核结论正确，也不能阻止绕开插件直接编辑文件。不得通过手改 JSON、直接更新 hash 或无实际审核的 record 来制造通过。

## 维护流程图与回归

```text
python shared/scripts/workflow_gate.py diagram --output shared/workflow-flowchart.md
python shared/scripts/test_workflow_gate.py
```

插件维护时，凡是改变阶段、先后顺序、适用条件、失败返回路径或变更后的复查方式，都必须同步检查流程图。先更新 `workflow.json` 及必要的生成逻辑，再生成 `workflow-flowchart.md`；不能只改某个 SKILL 的文字而留下旧图。仅措辞或示例变化且不影响流程时，说明无需改图的依据。

流程图同时呈现首次设计和后续变更两条入口。后续变更先判断影响，受影响项完成修正和增量复核，未受影响项核验证据后复用；两条路径最终都回到有效证据检查。复核范围服从各审核 Skill 的风险分级，不新增固定的全量审核或 Agent 轮次。

维护完成需确认：图与定义一致、变更分支没有绕过最终门禁、Mermaid 能正常渲染；运行上述回归。同步到其他插件副本和当前安装时，同时同步定义、生成器、生成图及规则，并核对内容一致。脚本审核语义变更需要行为回归；仅补齐图示不必提升工作流版本或使旧项目证据失效。升级工作流版本后先核验旧证据并迁移版本，不自动将旧状态全部变为通过。
