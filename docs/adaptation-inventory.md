# 组件适配盘点

盘点日期：2026-11-13。依据 Vault 台账、组件源码，以及只读核对的 SwitchAI 当前工作树
（`app/version.py` 为 `2026.11.13.3`，含未提交修改）；不把历史计划、文件复制或宿主功能当作独立交付。
下列链接相对本文件指向 Vault；外部依据统一写为 `SwitchAI` 加仓库相对路径，避免开发机路径依赖。

**当前独立 Vault Impeccable 与 Playwright 均已登记本机发行 1.0.0；Playwright 构建、安装、浏览器演示和双端原生发现已通过本地验证。**
SwitchAI 的记忆、测试宿主功能尚未迁移；既有包仍由其专用代码管理，现有接入保持不变。
Playwright 结果见 [验证报告](reports/2026-11-13-playwright-independent.md) 与
[发行记录](../registry/releases/playwright-test/1.0.0/windows-x64.json)；二进制未上传，未验证真实模型或公司 TP/内网业务验收。
源码快照见 [artifacts.json](../registry/artifacts.json)，独立发行见
[components.json](../registry/components.json) 与各版本发行记录，二者不能互相替代。

## 适配与交付状态

“上游改动”指对上游代码或指令内容的本地修改；“打包”指依赖、清单与分发；
“原生适配”指 Claude Code/Codex 的目录、配置、工具和会话接入；宿主 UI 单独列出。

| 组件 / 已知固定基线 | 上游内容与本地行为变化 | 离线打包、原生适配 | 宿主 UI / Vault 迁移状态 |
| --- | --- | --- | --- |
| Impeccable：Skill `4.8.2`，提交 `b4bff1626c344067788c2679f048a20057c7cc5a`；引擎 `0.1.22`；Vault `1.0.0` | 上游 Skill、参考资料及启动器原样保留，无审查规则分叉。 | Vault Windows x64 包含固定引擎、许可证、逐文件清单；PowerShell 管理安装/状态/自检/卸载，项目安装到 `.claude/skills` 或 `.agents/skills`，用户范围显式指定客户端根目录；不改模型、MCP、Hooks 或原生子 Agent 注册。 | **独立组件已发布**，ZIP 单独分发，发行记录无下载 URL。SwitchAI 扩展中心仍只内置静态推荐资产，不含引擎，也未接入 Vault 管理接口；浏览器 live、截图和模型审查不是本包全部自带的能力。[I] |
| Playwright：Vault 本机发行 `1.0.0`，Windows x64；上游/Test MCP `1.60.0`；Node `24.11.1`；Chromium/无头版 `148.0.7778.96`、修订 `1223`；FFmpeg `1011`、winldd `1007`；既有 SwitchAI 包 `1.60.0-switchai.1` 单独保留 | Vault 构建器选择固定来源包的运行库、浏览器与许可证，不带入宿主插件/适配脚本；另保留原始 Agent 来源及哈希。独立 Planner/Generator/Healer 改用 `mcp__vault_playwright__*`、托管 seed/fixture 和诚实失败约束；独立 MCP 适配器限制计划/测试输出路径及写注解。Git 索引检出副本第二次构建与实际 ZIP 哈希一致。 | **已通过本地验证**。共享不可变版本缓存与项目 `.agent-vault-tests` 分开，显式 `install/check/enable`；Claude Skill、三个原生 Agent 和项目 `.mcp.json`，Codex Skill、角色参考资料和项目 `.codex/config.toml`，两端 MCP 均为 `vault_playwright`。管理动作不调用模型、不启用 Hooks、不改全局设置；目标无需 Python，卸载保留用例、报告及共享缓存。 | 已验证实际安装、七用例缺陷/修复浏览器重放、双端发现及 MCP 协议，未提交模型 turn。**SwitchAI 宿主功能未迁移，现有接入不变**；其 `switchai_testing`/`.switchai-tests` 与 Vault 独立。不声明模型自主选择或 TP 验收。通用市场浏览器 MCP 与 Test Agents 组件仍是不同入口。[P] |
| claude-mem：`15.17.0`，提交 `6b779c06796138aeb4b0ee2fa7dbd25912e4f7fb`；Node `24.11.1`、Bun `1.4.4`；`sqlite-fts` 配置 | 构建时删除 Setup 版本检查及 SessionStart `ensure-launcher` 安装/修复钩子，保留采集、上下文与检索。宿主配置关闭 Chroma、自动更新和遥测；这是所选配置，不代表上游全部能力。 | SwitchAI ZIP 含插件、Worker、Viewer、运行依赖和许可证；SDK 本地插件接入，逐项目启用、按 cwd 隔离数据，最多四个受监督 worker；连接解析只向 observer 传允许字段，保留原生设置并拒绝重复原生安装。 | `/plugins` 与扩展中心管理；独立隔离窗口复用上游 Viewer，仅查看禁用 observer。**记忆宿主功能未迁移到 Vault**，不能把既有 ZIP 称为双端独立组件；模型整理仍需用户连接。[M] |
| DesignSession：Claude `1.0.5`；Codex `1.0.5+codex.20261010.mastergo` | 自维护流程内容包含证据指纹、增量数据库审核、权限事实源核对、概要设计可读性与 Agent 失败快速退出；这些是流程变更，不能只记作格式转换。 | 双端共享业务规则，保留各自 `.claude-plugin` / `.codex-plugin` manifest、命令描述和 Codex Agent 展示元数据；Python 流程校验、可选浏览器依赖须另备，不是独立服务运行时。 | **源码插件快照**，无完整离线组件发行记录；客户端发现/执行须单独验证，不能从目录或旧 README 的安装示例推断双端可用。[D] |
| MasterGo：启动配置 `config-snapshot-20260627`；npm `@mastergo/magic-mcp` 为 **unpinned**；DesignSession 导出适配随 `1.0.5` | 未收录或修改 MCP server 实现；本地启动器与只读导出脚本是新增适配。支持 MCP 优先、只读接口/浏览器兜底，PNG 由 `window.mg.exportPng` 单独导出，结构与图片状态分别记录。 | 两侧保存启动器，Codex 有 TOML 示例，Claude 须按其 MCP 格式配置。启动器仍是 `npx -y` 未锁版本；导出另需 Node、Playwright、浏览器及用户 token/登录，均不等于已打包服务。 | **配置/脚本快照**，未交付完整离线 MCP 运行包；无独立 Vault 宿主适配。不得把取得分区索引、页面壳或结构文本当作完整设计稿/PNG。[G] |
| Office Skills：`doc`、`spreadsheet`、`slides` 均为 `snapshot-20260627`，无声明的上游版本 | 保存 Codex Skill 内容、渲染/校验脚本和幻灯片布局助手，镜像至 Claude；未据此声明 Office 引擎有本地改造。 | 文档使用 python-docx，表格使用 openpyxl/pandas，幻灯片使用 PptxGenJS；Python/Node 包、LibreOffice、Poppler 等仍需另外准备，未形成锁定的完整运行依赖包。 | **Skill 源码快照**，双端文件同步不等于功能验证；无独立 Vault 离线发行或宿主 UI 交付记录。[O] |
| Paperclip team runtime：`@paperclipai/server 2026.1023.0`；Node `24.11.1`；Windows x64 `switchai-process` 配置 | 上游运行 JS 不改；打包排除未用的 Codex/OpenCode/Claude 原生引擎载荷，保留许可证。`server.mjs` / `bridge.mjs` 是宿主新增脚本。 | SwitchAI ZIP 提供 Paperclip、Node 和数据库运行资源；按需启动 loopback 服务及 embedded PostgreSQL，关闭遥测/更新，拥有的 Windows Job 负责回收。process 桥接复用本机 Claude 执行，不附带或替代 Claude CLI。 | 团队 UI、角色约束、工作树、验证及应用改动归 SwitchAI；工作树不是 OS 沙箱，应用不授权提交/发布。**尚未迁入 Vault**；这是特定配置的团队运行包，不是仅指令快照，也不是所有 Agent 引擎合集。[T] |
| Hermes editing primitives：提交 `e5ea5fd9ccdf2913c0b21b24eb3d22b321d2e2a6`，MIT | 只 vendoring `fuzzy_match.py` 和 `escape_drift_autocorrect.py`；前者仅把导入改为包内相对导入，后者原样，来源清单保留原始/本地哈希。 | Python 标准库编辑原语，不读写文件、不执行工具、不管理会话；宿主 `claude_skill_editor.py` 承担路径、大小、草案、并发与持久化边界。 | SwitchAI 用于受限助手维护及草案预览/安装。**不是完整 Hermes runtime，ACP 未实现**；未形成 Vault 独立组件。[H] |

## 源码依据

- [I] Vault：[组件定义](../components/impeccable/component.json)、[构建器](../components/impeccable/build.py)、[管理器](../components/impeccable/manage.ps1)、[发行记录](../registry/releases/impeccable/1.0.0/windows-x64.json)。SwitchAI：`app/assets/recommended-extensions/UPSTREAM.json`、`app/core/claude_extensions.py`、`docs/component-integration-boundary.md`。
- [P] Vault：[组件定义](../components/playwright-test/component.json)、[来源与 Agent 适配](../components/playwright-test/UPSTREAM.json)、[构建器](../components/playwright-test/build.py)、[管理器](../components/playwright-test/scripts/manage.cjs)、[原生配置适配](../components/playwright-test/scripts/native-config.cjs)、[MCP 适配](../components/playwright-test/scripts/mcp.cjs)、[Claude Skill](../claude-code/skills/vault-playwright/1.0.0/SKILL.md)、[Codex 镜像](../codex/skills/vault-playwright/1.0.0/SKILL.md)、[独立化计划](plans/2026-11-13-playwright-independent.md)。SwitchAI：`app/assets/playwright-test-component.json`、`scripts/build_playwright_component.py`、`components/playwright-test/plugin/agents/playwright-test-healer.md`、`app/assets/playwright-test-mcp.cjs`、`app/core/claude_testing_component.py`、`app/core/claude_testing_runtime.py`、`app/web/claude_desktop/testing-component.js`、`docs/offline-components.md`。
- [M] SwitchAI：`app/assets/claude-memory-component.json`、`scripts/build-claude-memory-component.py`、`app/core/claude_memory_component.py`、`app/core/claude_memory_connection.py`、`app/core/claude_memory_runtime.py`、`app/ui/claude_memory_viewer.py`、`docs/claude-memory.md`。构建器只明确裁剪上述钩子，不能据此宣称全部预备依赖与上游逐字节一致。
- [D] Vault：[Claude manifest](../claude-code/plugins/design-session/1.0.5/.claude-plugin/plugin.json)、[Codex manifest](../codex/plugins/design-session/1.0.5/.codex-plugin/plugin.json)、[证据引擎规则](../codex/plugins/design-session/1.0.5/shared/design-session-engine.md)、[数据库审核](../codex/plugins/design-session/1.0.5/skills/database-review/SKILL.md)、[更新记录](update-log.md)。
- [G] Vault：[Codex 启动器](../codex/mcp-servers/mastergo-magic/start_mastergo_magic_mcp.ps1)、[配置示例](../codex/mcp-servers/mastergo-magic/codex.config.example.toml)、[Claude 接入说明](../claude-code/mcp-servers/mastergo-magic/README.md)、[导出脚本](../codex/plugins/design-session/1.0.5/skills/mastergo/scripts/fetch_mastergo.cjs)、[导出规则](../codex/plugins/design-session/1.0.5/skills/mastergo/SKILL.md)。
- [O] Vault：[doc](../codex/skills/doc/SKILL.md)、[spreadsheet](../codex/skills/spreadsheet/SKILL.md)、[slides](../codex/skills/slides/SKILL.md)、[DOCX 渲染器](../codex/skills/doc/scripts/render_docx.py)、[Claude 快照目录](../claude-code/skills/)、[离线依赖限制](offline-deployment.md)。版本来源见上方 `artifacts.json`。
- [T] SwitchAI：`app/assets/team-runtime.json`、`app/team_runtime/THIRD-PARTY.md`、`scripts/build-team-runtime.py`、`app/team_runtime/server.mjs`、`app/team_runtime/bridge.mjs`、`app/core/team_runtime.py`、`app/core/team_local.py`、`docs/team-workbench.md`。
- [H] SwitchAI：`app/vendor/hermes/UPSTREAM.json`、`app/vendor/hermes/fuzzy_match.py`、`app/vendor/hermes/escape_drift_autocorrect.py`、`app/core/claude_skill_editor.py`、`app/core/claude_assistant_maintenance.py`、`docs/hermes-integration.md`。

## 维护与回归热点

以下是后续升级应核验的范围；Playwright 本轮实际结果见上方报告，其余测试路径仅用于定位覆盖。

| 组件 | 本地适配回归热点 | 应继续复用上游的部分 |
| --- | --- | --- |
| Impeccable | 双端目录/发现、引擎握手与哈希、用户改动冲突、备份/卸载保留、换行及检出重建；Vault [组件测试](../tests/test_impeccable_component.py)。 | Skill 规则、参考资料、启动器和原生引擎，避免在宿主再实现审查器。 |
| Playwright | Test MCP 内部模块/工具 schema、写注解与路径/链接拒绝、ESM/中文与空格路径、不可变缓存与配置所有权、启停/证据保留、零测试/跳过/真实失败语义；Vault [构建用例](../tests/test_playwright_build.py)、[管理用例](../tests/playwright-management.test.cjs)、[演示用例](../tests/playwright-demo.test.cjs) 及双端原生发现已有本地证据。构建器一项 Windows 符号链接权限检查跳过，升级仍须重验。 | 浏览器驱动、Test runner、locator、trace/录屏/报告及官方 Agent 基础流程；本地保留必要的输出边界与诚实修复约束。 |
| claude-mem | Hook/observer 协议、原生连接映射、重复安装、cwd 隔离、仅查看不调用模型、数据兼容与拥有进程回收；SwitchAI `tests/test_claude_memory_component.py`、`tests/test_claude_memory_connection.py`、`tests/test_claude_memory_viewer.py`。 | 采集、整理、SQLite/FTS、检索和 Viewer；宿主通过薄适配限制配置，不重写记忆系统。 |
| DesignSession | 双端 manifest/工具映射、证据失效、增量审核范围、失败退出和交付正文边界；Vault [流程规则](../codex/plugins/design-session/1.0.5/shared/design-session-engine.md)。 | 共享流程规则与校验器单一事实源；客户端差异留在包装层。 |
| MasterGo | MCP schema、站点 API/浏览器运行对象、token 同源限定、不保存凭据、登录与 PNG/结构覆盖度分离；Vault [本地脚本用例](../codex/plugins/design-session/1.0.5/skills/mastergo/scripts/test_fetch_mastergo.cjs)。运行依赖须先锁定再声称完整离线包。 | MCP server、设计平台解析/导出能力；本地只保留接入、兜底与证据落盘。 |
| Office Skills | 双端快照差异、依赖版本、字体/渲染、公式重算、幻灯片重叠与可编辑性；不能用成功写文件代替视觉检查。 | 文档/表格/幻灯片库及渲染器；复用 Skill 与布局助手，不为宿主复制一套 Office 引擎。 |
| Paperclip | process API、数据库迁移、离线清单/引擎裁剪、桥接鉴权、取消与进程树、角色权限和工作树应用；SwitchAI `tests/test_team_runtime.py`、`app/core/team_permissions.py`。 | Paperclip 调度、数据库及服务 API；宿主负责原生 Claude 接入、权限与业务 UI。 |
| Hermes | 模糊/重复匹配、转义纠正、失败正文不变、replace_all 限制、路径与版本边界；SwitchAI `tests/test_hermes_edit_primitives.py`、`tests/test_claude_skill_editor.py`。 | 两个编辑原语保持可对比的小补丁；完整 Hermes/ACP 若后续接入须单独定版和验证。 |

本轮组件验证结果由控制器提供并落盘报告；本文件维护仅核对源码、台账、链接与文档差异。
开发原生夹具导入开发环境 SDK 库，不导入 SwitchAI 源码，不构成目标机的 Python 依赖。
没有调用真实模型或业务服务，没有修改个人配置。发布与迁移判断遵循
[组件边界](component-rules.md) 和 [版本规则](component-versioning.md)，不借用旧报告的测试计数。
