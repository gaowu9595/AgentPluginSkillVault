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

离线版本目录为 [components.json](registry/components.json)，每个 ZIP 的版本、来源、
大小和 SHA256 记录在 `registry/releases/`。ZIP 单独分发；当前不提供虚构的下载地址。

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
