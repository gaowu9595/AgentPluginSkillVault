# Update Log

## 2026-09-21

- 按跨客户端同步准则补齐 `design-session` 1.0.4 Claude Code 侧的 `analyze`、`requirements-clarify` 和 `database-review` 规则，使证据指纹、状态索引、产品确认门禁和概要设计/数据库编码契约边界与 Codex 侧一致；保留 Claude Code 命令描述的客户端格式差异。
- 修正 Claude/Codex 两侧插件 README 的当前版本指向 `1.0.4`。
- 验证：Claude/Codex 工作流行为测试各 19 项通过；两侧 Office skill 文件镜像校验通过；插件 manifest、registry JSON、数据库效率校验、数据库 Skill 校验和权限证据门禁通过。
- 可读性回归脚本仍报告外部 `knowledge-service/OverseaPartner` 当前文档缺少历史 r13 基线中的 253 个合同 token；该文件不属于本仓库，本次不修改外部业务文档，保留失败信息供后续在外部项目修复或更新回归基线。

## 2026-09-20

- Design Session 将面向人的接口说明固化进既有设计与责任附件；每个接口只有一处完整详细定义，主设计保留用途、关键输入输出、边界及引用。不再按“人读版/AI 版”重复维护。
- `write`、指南与模板补齐业务例子、调用边界、处理流程、嵌套字段路径、类型/单位、必填/可空/默认/枚举、字段来源、失败后的调用方动作及适量示例。产品级 OpenAPI 也必须有中文说明，Schema 不能单独代替设计。
- `check/next/shared workflow` 将接口覆盖及语义一致性证据纳入既有 `content_gate`；不新增 gate 或独立审核轮次。复用准确的公共定义、未变接口契约及有效审核证据。
- 关键方案及取舍理由回写对应设计章节；字段来源可为既有存储、外部接口、配置或计算结果，不再要求所有接口字段都对应数据库列。
- 安全复核按真实影响执行；纯文档调整不触发全量数据库/安全审查，P2 不循环，重复阻塞或缺证据时保留缺口并收口。
- 同步 Vault Codex/Claude、Codex 本地源及工作区 Claude 的 6 个文件，保留客户端专属配置；官方 CLI 已安装 Codex `1.0.4+codex.20260920020027`，新会话加载该版。
- 验证：3 个 Skill 元数据检查、插件校验及现有 16 项流程行为测试通过。独立 Agent 完成旧版基线和新版场景试用：旧版能靠模型补充判断完成任务，但相关要求缺少明文约束；新版实际产出可读接口小节、如实标记缺失证据，并对只搬移文档的反例复用有效审核。未宣称旧版试用失败或机械校验能证明语义完整。
- 本次仅更新插件及版本记录，不改业务代码、不重写迭代 5 设计、不混入已有未提交改动进行提交。

## 2026-09-18

- Design Session 增加单一流程定义 `shared/workflow.json`，由脚本生成 [分支流程图](../codex/plugins/design-session/1.0.4/shared/workflow-flowchart.md)；[流程规则](../codex/plugins/design-session/1.0.4/shared/workflow.md) 说明状态、证据、增量复查及适用性。
- `next/write/check` 使用同一个本地校验器，逐项检查范围、报告、输入指纹。缺证据、过期、别名冲突及未经证明的不适用均不放行；局部数据库通过仅适用于微型设计当前范围。
- 既有报告核验后复用；不因升级要求所有项目重新审查。未采用 LangGraph，不新增常驻服务，不修改业务代码或项目审核结论。
- Vault Codex/Claude、Codex 本地源、工作区 Claude 插件同步 23 个流程文件及必要审核依赖；保留各客户端 manifest。Codex 通过官方 CLI 重新安装为 `1.0.4+codex.20260918081703`，新会话加载新版本。
- 验证：16 项本地行为测试通过；6 个 Skill 元数据检查、插件校验、既有数据库效率/格式及权限门禁回归通过。独立 Agent 完成一次旧流程基线检查和一次新流程试用，包括新增源码文件使相关证据失效的场景。
- 变更仅持久化和安装；未将仓库已有大量未提交修改混入提交。校验器约束插件流程入口/可选 CI，不能阻止绕开插件直接编辑文件，也不替代语义审核。

## 2026-06-10

- 新建 `AgentPluginSkillVault` 仓库。
- 导入当前 Codex cache 中的 `design-session` 插件快照：

```text
C:\Users\Administrator\.codex\plugins\cache\claude2codex-local\design-session\1.0.0
```

- 建立 Claude Code / Codex / converter 三类目录，后续更新可以按来源和目标形态分开追踪。
- 找到并导入 Claude Code 原始 `design-session` 插件：

```text
E:\py_workspace\knowledge-service\.claude\plugins\plugins\design-session
```

- Claude Code 插件索引来源：

```text
C:\Users\Administrator\.claude\plugins\installed_plugins.json
design-session@local-plugins -> E:\py_workspace\knowledge-service\.claude\plugins
```

## 2026-06-27

- 导入本机已安装的官方 Codex Office 文档类 skill 快照：

```text
C:\Users\Administrator\.codex\skills\doc
C:\Users\Administrator\.codex\skills\spreadsheet
C:\Users\Administrator\.codex\skills\slides
```

- 落盘位置：

```text
codex/skills/doc/
codex/skills/spreadsheet/
codex/skills/slides/
```

- 备注：这些目录只保存 skill 本体和随包脚本/示例。离线或内网环境仍需提前准备各 skill 所需的 Python/Node/LibreOffice/Poppler 等运行依赖。
- 记录当前 Codex MCP server 配置：`mastergo-magic`。

```text
C:\Users\Administrator\.codex\config.toml
E:\py_workspace\knowledge-service\Workflow\.ai\tools\start_mastergo_magic_mcp.ps1
```

- 落盘位置：

```text
codex/mcp-servers/mastergo-magic/
```

- 备注：该 MCP server 当前通过 `npx -y @mastergo/magic-mcp` 启动。内网离线部署时，需要提前准备 Node.js 和 `@mastergo/magic-mcp` 的离线 npm 包或 npm cache；本仓库当前只保存配置片段和启动脚本。

- 新增统一版本台账：

```text
registry/artifacts.json
```

- 版本规则：插件使用 manifest 版本；无版本字段的 standalone skill 使用 `snapshot-YYYYMMDD`；无 server 版本的 MCP 配置使用 `config-snapshot-YYYYMMDD`，并单独记录运行包版本是否 pin。
- 新增跨客户端同步准则：后续任一 skill、plugin 或 MCP 的新增、更新、删除，都必须同时检查 Claude Code 与 Codex 两侧；能同步的必须同步更新，不能同步或不适用的必须在 `registry/artifacts.json` 和本日志中说明原因。
- 按跨客户端同步准则补齐 Claude Code 侧快照：

```text
claude-code/skills/browser-proxy-access/
claude-code/skills/doc/
claude-code/skills/spreadsheet/
claude-code/skills/slides/
claude-code/mcp-servers/mastergo-magic/
```

- 同步说明：Claude Code 侧 skill 目录镜像 Codex 侧同名 skill 快照；`mastergo-magic` MCP 保留同一启动脚本快照，但 Claude Code 的实际 MCP 配置需要按目标客户端版本格式迁移，不能直接复用 Codex TOML。

## 2026-07-21

- 更新 `design-session` Codex/Claude Code 插件源，新增 `requirements-clarify` skill。
- skill 用于系统需求编写前的材料回溯、代码事实核对、用户旅程解释和关键产品确认问题整理；不把已有摘要当作唯一输入。
- Codex 插件版本使用 `1.0.0+codex.local-20260721-090150` 触发本地重新安装，插件管理器已确认安装并启用。
- Codex 与 Claude Code 两侧已同步 `SKILL.md` 和输出模板；Codex 侧额外包含 `agents/openai.yaml` UI 元数据。
- 根据真实按月计费澄清复盘升级 `requirements-clarify`：增加独立需求范围矩阵、P0 判定公式、五道问题过滤门、问题数量异味检查和候选问题处置表。
- 明确代码已有行为、已确认范围、相邻需求、纯研发实现和视觉细节不得重复进入产品 P0；外部数据先由产品确认业务口径/责任人，再由开发完成技术契约。
- 输出改为内部事实基线与产品确认清单双模板，产品版要求先说明旅程、列出现有事实，再给出带开发建议的少量关键问题。

## 2026-07-28

- 将 `design-session` 升级为 1.0.2，并同时发布 Claude Code/Codex 两侧快照。
- 新增并持久化 `database-review` V2：保留首次逐表逐字段和资金安全严格门禁；完整覆盖基线后的修订按 `full/delta/deterministic-only` 自动路由。
- failed 但覆盖、hash、原始输出和主裁决完整的基线允许 delta，不再被迫重新审核全部表和字段。
- 数据库 Skill 只启动数据模型/资金工程中受影响的方向，不再启动全栈 Agent；P2 只登记，自动修复复审最多一轮。
- 401/402/403 和 payment/quota/auth/permission 错误立即返回 independent_review_unavailable，不等待、不重试、不切第三个 Agent。
- 新增效率回归脚本和 CASE-10~14，源插件、用户插件、运行缓存及 Vault 双端快照均通过校验。
- 将 `design-session` 升级为 1.0.3，并新增 Claude Code/Codex 双端版本快照，保留 1.0.2 供回退。
- 概要设计新增“评审主文档 + 编码附件”分层规则：主文档保留范围、整体方案、关键流程、数据职责、不变量和风险，完整 DTO/DDL/函数 manifest/测试矩阵进入主题附件。
- 新增 `/design-session:check design-quality` 和确定性脚本 `validate_design_readability.ps1`，校验强制章节、动态篇幅阈值、长段落、超长代码块、方案选型顺序、本地链接，以及重构前后合同是否无损。
- `database-review` 明确详细逐表逐字段结果写入数据库编码契约，主概要设计只回写表职责、关系、核心不变量、事务边界和 P0/P1 裁决，禁止把 Agent 全量审计过程追加到主文档。
- 新增真实文档回归：r13 超长主文档必须失败，r14 主文档加完整附件必须通过，遗漏附件必须因合同缺失失败；保留数据库审核效率回归。
- 将 `design-session` 升级为 1.0.4，并新增 Claude Code/Codex 双端版本快照，保留 1.0.3 供回退。
- 概要设计和安全审查新增通用权限证据门禁：先发现项目权限事实源，逐接口说明复用或新增并提供代码证据；禁止在没有项目证据时创造角色、权限码或授权层。
- 项目提供确定性权限校验命令时必须执行并记录结果；门禁本身不包含任何具体项目、权限框架或字段名。
