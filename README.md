# Agent Plugin Skill Vault

这个仓库用于持久化保存自己开发或转换过的 Agent 插件、Skill 和转换资料，覆盖 Claude Code 与 Codex 两套形态。

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

- `claude-code/plugins/design-session/1.0.4/`：当前 Claude Code `design-session` 原始版本，包含 `requirements-clarify`、database-review V2、概要设计可读性门禁和通用权限证据门禁。
- `codex/plugins/design-session/1.0.4/`：当前 Codex 转换版本；支持 `design-quality`、数据库首次全量/后续增量审核、权限事实源核对，以及 Agent 失败快速退出。
- `claude-code/skills/browser-proxy-access/`、`claude-code/skills/doc/`、`claude-code/skills/spreadsheet/`、`claude-code/skills/slides/`：与 Codex 侧同名 skill 保持同步的 Claude Code skill 快照。
- `codex/skills/browser-proxy-access/`、`codex/skills/doc/`、`codex/skills/spreadsheet/`、`codex/skills/slides/`：从本机 Codex skills 目录导入或整理的 skill 快照，用于代理访问、`.docx`、`.xlsx`/`.csv`/`.tsv`、`.pptx` 文件处理。
- `claude-code/mcp-servers/mastergo-magic/`：与 Codex 侧保持同步的 MasterGo Magic MCP 启动脚本快照和 Claude Code 接入说明。
- `codex/mcp-servers/mastergo-magic/`：从本机 Codex 配置导入的 MasterGo Magic MCP 配置快照和启动脚本。

导入来源：

```text
E:\py_workspace\knowledge-service\.claude\plugins\plugins\design-session
C:\Users\Administrator\plugins\design-session
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
