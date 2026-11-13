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

## claude-mem 独立组件：本地验证候选

[组件说明](../components/claude-mem/README.md) 定义 `1.0.0` 候选，目标为 Windows 10 / Windows Server 2016 及以上 x64，
固定 claude-mem `15.17.0`、Node `24.11.1`、Bun `1.4.4` 和 SQLite/FTS。
Worker/MCP 功能和双端原生初始化已有本地验证历史；端口补丁后的新归档须单独关联验证证据。
状态为 `local-verification-candidate`、`redistributionReady=false`：第三方完整源码配套尚未交付，未宣称完成公开二进制发行。
本地功能验证与公开再分发状态分开记录。
新归档版本、字节数、ZIP 与 manifest 校验值统一见候选 [归档记录](../registry/releases/claude-mem/1.0.0/windows-x64.json)，
不要将旧候选的校验值用于新包。
ZIP 仅存本机，无已上传的下载地址；源码提交不代表二进制或源码配套已上传。
此候选不改变前两包的已验证状态；最低系统要求不代表所有系统版本均已实测。
安装不启用 Hooks、不启动服务、不调用模型；包内提供 Node/Bun，目标无需 Python 或 npm 下载。

评估可信来源的候选 ZIP 时，先按随包发行记录（sidecar）核对校验值，再从解压目录按项目执行：

```powershell
.\manage.ps1 -Action install -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action check -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action enable -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action viewer -Client claude -Project 'D:\Codes\my-project'
```

Codex 改用 `-Client codex`；默认两端均为手动保存/检索，项目 Skill 为 `vault-memory`
（`.claude/skills` 或 `.agents/skills`），项目 MCP 为 `vault_memory`（`.mcp.json` 或 `.codex/config.toml`）。
不改全局账号、模型或权限设置，原生信任和审批仍须遵循客户端要求。
启用后，在项目目录开启新原生会话：Claude Code 使用 `/vault-memory`，Codex 使用 `$vault-memory`，
先检索再要求保存有来源的项目事实，保存成功以工具返回为准；新会话可再次检索确认。
在浏览器打开 `viewer` 返回的 `viewerUrl`，查看本项目记录。
仅 Claude 明确 `enable -Capture` 才登记项目自动采集 Hooks；Codex 本版不提供自动采集。
自动采集需已有 Claude 模型连接，可能消耗额度；手动记忆、查看与自检不需观察模型。

`configure -ClaudeHome <已有Claude配置目录绝对路径>` 只选择已有连接来源，先停用该项目两端；
不接受密钥 CLI 参数，不重写原生模型设置，不执行凭据 helper。显式采集启动 observer 时，
可在 Git 外的 `<项目私有数据目录>/native-empty/observer.env` 写入允许的连接环境字段，供上游查找凭据；
该文件可能含凭据，不随包分发，reader 不生成或加载它。
写入前设置并核验 Windows 私有 DACL，仅允许当前用户与 SYSTEM；权限不满足时拒绝写入。
确认拥有的 worker 停止后清理受管 `observer.env` 及其临时副本，保留数据库。
`start` 默认启动 reader（observer 关闭），
`viewer` 返回上游 loopback URL，不另做 UI；若已存在观察 worker，查看可复用而不强制关闭它。
reader 升级 observer 在完整生命周期锁与身份核验下复用原端口、创建新 generation；
端口被占则返回 `EADDRINUSE`，不随机回退或接管，既有 MCP 固定 URL 的端口不会因升级主动变更。
`check` 不提交模型 turn。`stop` 仅停止拥有的 worker，仍启用的 Hooks/MCP 之后可能重启；
需停用能力时执行 `disable`，它使旧 Hooks 不能继续启动采集。

安装可选 `-RuntimeRoot` 共享缓存基目录，默认版本目录为
`%LOCALAPPDATA%/AgentPluginSkillVault/components/claude-mem/1.0.0`；
`-DataRoot` 可选私有基目录，默认为 `%LOCALAPPDATA%/AgentPluginSkillVault/data/claude-mem`，
按项目 key 隔离，必须位于 Git、项目与运行包之外。状态位于
`.agent-vault/claude-mem/<client>/project.json`。卸载保留记忆和共享缓存，不导入旧数据库。
无 SwitchAI 源码依赖、配置读取或私有数据迁移，原有宿主接入不变。

实际检查范围与限制见 [验证报告](reports/2026-11-13-claude-mem-independent.md)。补丁后的两项真实本机测试已通过，
分别验证同端口新 generation、端口占用时拒绝且不回退/接管。补丁前 Runtime 27 项通过及旧候选的构建、
管理、原生发现、安装 smoke、采集和重建记录仍有效，但不能合并为补丁后的一次全量结果或新包验证完成结论。
这些本地结果不代表真实上游模型连接或实际业务验收。Impeccable、Playwright 保持已有发行状态；
claude-mem 仍是本地验证候选，Paperclip/Hermes 仅为宿主参考。

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
