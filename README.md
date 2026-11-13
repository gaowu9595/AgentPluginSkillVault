# Agent Plugin Skill Vault

代码仓库：[gaowu9595/AgentPluginSkillVault](https://github.com/gaowu9595/AgentPluginSkillVault)。

这个仓库用于持久化保存自己开发或转换过的 Agent 插件、Skill 和转换资料，覆盖 Claude Code 与 Codex 两套形态。

本仓库独立于 SwitchAI 维护，不依赖其源码或安装目录。已有条目以源码和配置快照为主，
不代表所有能力都已具备完整离线运行环境；部署前须按
[离线部署说明](docs/offline-deployment.md)准备依赖并验证目标客户端兼容性。
大型离线运行包单独分发，Git 保留对应的构建资料、版本记录及许可证。

AI 终端从 [AGENTS.md](AGENTS.md) 开始；当前进展见
[项目上下文](docs/project-context.md)。组件边界和升级要求分别见
[交付约束](docs/component-rules.md)与[版本管理](docs/component-versioning.md)。

## 离线组件

首个完整包为 [Impeccable 1.0.0](components/impeccable/README.md)：上游 Skill 4.8.2，
Windows x64 引擎 0.1.22。支持独立项目/用户范围安装、状态、自检及保留个人文件的卸载。
安装不改模型、MCP 或 Hooks；不需要 SwitchAI、Node 或 Python。

[Playwright Test 1.0.0](components/playwright-test/README.md) 已完成本地验证并登记本机发行。
目标为 Windows x64，固定 Playwright `1.60.0`、
Node `24.11.1`、Chromium `148.0.7778.96 / 1223`。运行依赖使用共享不可变版本缓存，
用例与证据位于项目 `.agent-vault-tests`；安装、自检、启用分别显式执行 `install/check/enable`。
Claude Code 安装三个原生 Agent；Codex 使用 Skill 内的角色参考资料。两端项目 MCP 名为
`vault_playwright`，管理动作不调用模型、不启用 Hooks、不修改全局设置。目标机无需另装 Python/Node，
SwitchAI 现有接入保持不变。已验证真实安装、浏览器缺陷/修复重放、双端原生发现及 Git 索引检出重建，
结果见 [验证报告](docs/reports/2026-11-13-playwright-independent.md)，来源和边界见
[适配盘点](docs/adaptation-inventory.md)。未验证模型自主选择或公司 TP/内网业务验收。

[claude-mem 候选 1.0.0](components/claude-mem/README.md) 状态为 **`local-verification-candidate`**。
`redistributionReady=false`：第三方完整源码配套尚未交付，未宣称完成公开二进制发行；本地功能验证与公开再分发状态分开记录。
固定上游 `15.17.0`、Node `24.11.1`、Bun `1.4.4`，目标为 Windows 10 / Windows Server 2016 及以上 x64，SQLite/FTS，无需 Python。
显式执行 `install/check/enable`；安装不启动服务/采集，普通启用为两端登记 `vault-memory` Skill 与 `vault_memory` MCP 以手动保存/检索。
仅 Claude 显式 `enable -Capture` 才注册项目采集 Hooks；Codex 本版不提供自动采集。
显式采集启动 observer 时可在 Git 外写入私有 `observer.env` 供上游查找凭据；reader 不生成或加载该文件。
凭据写入前限制 Windows DACL，确认停止后清理受管凭据文件，保留记忆数据库。
复用上游 loopback Viewer，私有记忆存于 Git 外，卸载保留数据；不迁移 SwitchAI 或其他原生安装的数据。
reader 升级 observer 时，在生命周期锁与身份核验下复用原端口并创建新 worker generation；
端口被占则返回 `EADDRINUSE`，不随机改端口或接管其他监听者。补丁后的两项真实本机测试已通过。
新 ZIP 的独立构建哈希一致，完整归档校验及实际解压包的七项安装/记忆旅程均通过；
同一真实 MCP 连接跨模式升级也通过。采集回放和原生发现的批次与限制单独记录，不宣称真实模型或内网验收通过。
完整证据见 [验证报告](docs/reports/2026-11-13-claude-mem-independent.md)，
新归档身份与校验值以 [候选记录](registry/releases/claude-mem/1.0.0/windows-x64.json) 为准。二进制未上传。

离线组件目录为 [components.json](registry/components.json)。已发行 ZIP 的版本、来源、大小和 SHA256
记录在 `registry/releases/`，Playwright 见 [1.0.0 发行记录](registry/releases/playwright-test/1.0.0/windows-x64.json)。
ZIP 单独分发，目前仅在本机保存，未上传二进制；不提供虚构的下载地址。

源码台账与离线发行分开：已收录双端 `vault-memory` 源码，实际发行状态以组件目录和不可变发行记录为准。
Impeccable 与 Playwright 保持已有发行状态，claude-mem 按本地验证候选管理。
Paperclip 和 Hermes 仅是 [盘点](docs/adaptation-inventory.md) 中的宿主参考，不属于 Vault 收录内容。

## 目录约定

- `claude-code/plugins/`：Claude Code 原始插件。建议路径：`<plugin-name>/<version>/`。
- `claude-code/skills/`：Claude Code 原始 Skill。
- `claude-code/mcp-servers/`：Claude Code MCP server 配置快照、启动脚本和离线部署说明。
- `codex/plugins/`：Codex 插件或由 Claude Code 插件转换出的 Codex 版本。建议路径：`<plugin-name>/<version>/`。
- `codex/skills/`：Codex standalone Skill。
- `codex/mcp-servers/`：Codex MCP server 配置快照、启动脚本和离线部署说明。
- `converters/claude-to-codex/`：Claude Code 到 Codex 的转换脚本、规则、提示词、映射说明。
- `docs/`：变更记录、迁移记录、兼容性说明。
- `registry/`：机器可读的插件、skill、MCP 版本台账。

## 当前快照

- [Claude vault-memory 1.0.0](claude-code/skills/vault-memory/1.0.0/SKILL.md) 与
  [Codex 同名 Skill](codex/skills/vault-memory/1.0.0/SKILL.md)：手动记忆接入源码候选；具体版本的功能与归档证据见报告。
  Claude 采集须单独授权，Codex 自动采集不在本版范围。
- [Claude vault-playwright 1.0.0](claude-code/skills/vault-playwright/1.0.0/SKILL.md) 与
  [Codex 同名 Skill](codex/skills/vault-playwright/1.0.0/SKILL.md)：镜像源码依赖上述独立组件；
  安装、浏览器重放及双端原生发现已有本地验证，模型自主选择与实际业务验收另行验证。
- `claude-code/plugins/design-session/1.0.5/`：Claude Code 原生快照，业务规则同步当前 Codex App 基准，保留 Claude manifest 与命令格式。
- `codex/plugins/design-session/1.0.5/`：当前 Codex App 快照 `1.0.5+codex.20261010.mastergo`；新增 MasterGo/SeerDesign 链接隐式触发与无 MCP 的 PNG 导出兜底；保留 `design-quality`、数据库增量审核、权限事实源核对及 Agent 失败快速退出。
- `claude-code/skills/browser-proxy-access/`、`claude-code/skills/doc/`、`claude-code/skills/spreadsheet/`、`claude-code/skills/slides/`：与 Codex 侧同名 skill 保持同步的 Claude Code skill 快照。
- `codex/skills/browser-proxy-access/`、`codex/skills/doc/`、`codex/skills/spreadsheet/`、`codex/skills/slides/`：从本机 Codex skills 目录导入或整理的 skill 快照，用于代理访问、`.docx`、`.xlsx`/`.csv`/`.tsv`、`.pptx` 文件处理。
- `claude-code/mcp-servers/mastergo-magic/`：与 Codex 侧保持同步的 MasterGo Magic MCP 启动脚本快照和 Claude Code 接入说明。
- `codex/mcp-servers/mastergo-magic/`：从本机 Codex 配置导入的 MasterGo Magic MCP 配置快照和启动脚本。

导入来源：

```text
E:\py_workspace\knowledge-service\.claude\plugins\plugins\design-session
C:\Users\Administrator\.codex\plugins\cache\claude2codex-local\design-session\1.0.4+codex.20260920111435
C:\Users\Administrator\.codex\skills\doc
C:\Users\Administrator\.codex\skills\spreadsheet
C:\Users\Administrator\.codex\skills\slides
C:\Users\Administrator\.codex\config.toml
E:\py_workspace\knowledge-service\Workflow\.ai\tools\start_mastergo_magic_mcp.ps1
```

## 更新流程建议

1. 原始 Claude Code 版本更新时，先放入 `claude-code/plugins/<name>/<version>/`。
2. 转换规则或脚本更新时，放入 `converters/claude-to-codex/` 并记录原因。
3. 转换后的 Codex 版本放入 `codex/plugins/<name>/<version>/`。
4. 任一 skill、plugin 或 MCP 新增、更新、删除时，必须同时检查 Claude Code 与 Codex 两侧是否需要同步；能同步的必须同步更新，不能同步或不适用的必须说明原因。
5. 同步结果要写入 `docs/update-log.md`，并同步更新 `registry/artifacts.json` 的版本、来源和备注。
6. 每次稳定快照提交一次 git commit，方便回退和对比。

## 内网部署

- 离线部署原则和当前风险见 `docs/offline-deployment.md`。
- 统一版本台账见 `registry/artifacts.json`。
