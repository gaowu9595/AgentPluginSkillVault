# Offline Deployment Notes

这个仓库的定位是保存可审查、可复制的 Agent 插件、skill 和 MCP 配置快照，便于内网环境在不能联网下载的情况下交给大模型读取和部署。

完整组件与源码快照分别维护。组件的独立性、安装保护和验证要求见
[交付约束](component-rules.md)，版本、不可覆盖的发行记录及升级流程见
[版本管理](component-versioning.md)。已提供完整离线包的项目从
[组件目录](../registry/components.json)进入，按各自管理脚本安装；下面的手工依赖准备流程
适用于其余源码快照。首包为 [Impeccable](../components/impeccable/README.md)。

## Playwright 独立组件：本地验证发行

[组件源码与用法](../components/playwright-test/README.md) 对应已通过本地验证的发行版本 `1.0.0`。
目标为 Windows x64，固定 Playwright
`1.60.0`、Node `24.11.1`、Chromium `148.0.7778.96 / 1223`；包内提供运行依赖，
目标机无需另装 Node/Python，也不执行 npm 下载。原生客户端须由用户另行安装。
ZIP 仅保存在本机，未上传二进制；分发时对照
[发行记录](../registry/releases/playwright-test/1.0.0/windows-x64.json) 核对：`347895174` 字节，
SHA256 `3a87840a7a0edebd2a157fdf7c0326eb48e8252212c930716df915dc5f545a94`。
Git 索引检出副本的第二次构建得到相同哈希。按以下步骤显式安装、自检和启用。

1. 对照正式发行记录核对 ZIP 来源、版本和 SHA256，再解压到独立目录。
2. 从解压目录显式执行 `install`，随后执行 `check`，通过后再执行 `enable`：

```powershell
.\manage.ps1 -Action install -Client claude -Project '<已有项目绝对路径>'
.\manage.ps1 -Action check -Client claude -Project '<已有项目绝对路径>'
.\manage.ps1 -Action enable -Client claude -Project '<已有项目绝对路径>'
```

Codex 将 `-Client claude` 换成 `-Client codex`。两端仅支持项目范围，MCP 名称均为
`vault_playwright`：Claude 的项目 `.claude/skills/vault-playwright`、三个原生
`vault-playwright-test-*` Agent 和 `.mcp.json`；Codex 的项目 `.agents/skills/vault-playwright`
与 `.codex/config.toml`，三个角色仅为 Skill 参考资料，不注册 Codex 原生 Agent。
启用后另开原生会话，保留客户端的项目信任、MCP 审批和权限流程。

运行文件默认位于 `%LOCALAPPDATA%/AgentPluginSkillVault/components/playwright-test/1.0.0`，
多个项目复用同一不可变版本；`-RuntimeRoot` 可显式指定缓存基目录。项目用例和证据位于
`.agent-vault-tests`，不会把浏览器复制到各项目。卸载保留用例、报告、私人文件和共享缓存。
安装、自检、启用不调用模型、不启用 Hooks、不修改全局设置；浏览器自检使用本地 data 页面。
实际测试仍需要授权的业务地址、用例和登录前提，不能把自检当作业务验收。

SwitchAI 现有组件、原生接入和 `.switchai-tests` 保持不变，不读取或迁移其私有数据。
[验证报告](reports/2026-11-13-playwright-independent.md) 记录安装、浏览器重放与双端原生发现：
同一七条演示用例在缺陷版为 5 通过、2 失败（TC04/TC05，退出码 1），修复版为 7 通过（退出码 0）；
两轮各保留 11 张截图、7 个视频和 7 份 trace。原生初始化/发现未提交模型 turn，不能证明模型自主选择、
真实模型连接或公司 TP/内网业务验收。

开发验证夹具 [playwright_native.py](../tests/fixtures/playwright_native.py) 导入开发环境的
`claude_agent_sdk`、`mcp`、`pywin32` 库，不导入 SwitchAI 源码。Python 及这些 SDK 是开发验证依赖，
独立目标包无需 Python；用户运行管理器和测试使用系统 PowerShell 与包内 Node。

## 能离线保存的内容

| 类型 | 可持久化内容 | 不能只靠本仓库解决的内容 |
| --- | --- | --- |
| Skill | `SKILL.md`、脚本、示例、参考资料、许可证 | Python/Node/系统工具依赖 |
| Plugin | 插件目录、manifest、skill 子目录、共享资料 | 客户端 marketplace/install 机制的版本差异 |
| MCP | 配置片段、启动脚本、环境变量名、依赖说明 | MCP server npm/pip 包、外部服务 token、外部网络服务 |

## 其余源码快照的手工部署

1. 在联网机器上把可用版本导入本仓库，记录来源和日期。
2. 把仓库同步到内网。
3. 在目标机器上先安装基础运行时：Codex/Claude、Node.js、Python、Office/LibreOffice、Poppler 等。
4. 按目标客户端当前官方目录结构复制需要的 skill/plugin/MCP 配置。
5. 启动新会话后检查技能列表、插件列表和 MCP 工具是否可见。
6. 针对每类能力做最小功能测试，例如读取 `SKILL.md`、生成一个测试 `.docx`、启动 MCP 并列出工具。

## 兼容性策略

- 不依赖 Codex/Claude 的私有数据库、缓存索引或内部状态文件。
- 不把绝对路径写死为唯一安装方式；仓库中的路径只是来源记录或示例。
- 配置文件用 `*.example.*` 保存，部署时按目标机器路径调整后再合入客户端配置。
- 脚本只做薄封装，例如启动 MCP 或复制目录；不主动改写未知版本的配置结构。
- 每次客户端大版本更新后，先用一台测试机验证目录结构和配置格式，再更新本仓库说明。

## 跨客户端同步策略

- 仓库同时维护 Claude Code 与 Codex 两套形态；后续任何 skill、plugin 或 MCP 的新增、更新、删除都必须检查两侧是否需要同步。
- 对于同源能力，优先同时更新 `claude-code/` 与 `codex/` 下的对应快照，确保业务内容、参考资料、脚本和版本记录一致。
- 如果某项能力只适用于一侧，例如 Codex 专用 MCP 配置或 Claude Code 专用 marketplace 包装，必须在 `docs/update-log.md` 和 `registry/artifacts.json` 中说明不对称原因。
- 更新转换规则时，必须同步检查已有 Claude Code 原始版本和 Codex 转换版本是否需要重新生成。
- 完成同步后，用文件对比或清单检查确认两侧差异只剩客户端包装格式、配置格式或明确记录的不适用项。

## 版本策略

- `registry/artifacts.json` 是统一的机器可读版本台账。
- 插件优先使用 manifest 中声明的版本，例如 `plugin.json` 的 `version`。
- Skill 如果 `SKILL.md` 没有版本字段，就使用 `snapshot-YYYYMMDD` 作为仓库快照版本。
- MCP 配置如果没有 server 版本，就使用 `config-snapshot-YYYYMMDD`，并单独记录运行包版本。
- 运行包未 pin 时必须标注为 `unpinned`，例如当前 `@mastergo/magic-mcp`。

## 当前离线风险

- `doc`、`spreadsheet`、`slides` 已保存 skill 本体，但运行时仍依赖 Python 包和渲染工具。
- `mastergo-magic` 已保存 MCP 启动脚本和 Codex 配置片段，但 `@mastergo/magic-mcp` 仍需在内网预置 npm 包或 npm cache。
- `design-session` 插件已保存 Claude Code 和 Codex 两个快照，但后续客户端如果改变插件 manifest 或 marketplace 规则，需要按新规则迁移。
