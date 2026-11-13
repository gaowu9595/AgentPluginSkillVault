# Offline Deployment Notes

这个仓库的定位是保存可审查、可复制的 Agent 插件、skill 和 MCP 配置快照，便于内网环境在不能联网下载的情况下交给大模型读取和部署。

完整组件与源码快照分别维护。组件的独立性、安装保护和验证要求见
[交付约束](component-rules.md)，版本、不可覆盖的发行记录及升级流程见
[版本管理](component-versioning.md)。已提供完整离线包的项目从
[组件目录](../registry/components.json)进入，按各自管理脚本安装；下面的手工依赖准备流程
适用于其余源码快照。首包为 [Impeccable](../components/impeccable/README.md)。

## 能离线保存的内容

| 类型 | 可持久化内容 | 不能只靠本仓库解决的内容 |
| --- | --- | --- |
| Skill | `SKILL.md`、脚本、示例、参考资料、许可证 | Python/Node/系统工具依赖 |
| Plugin | 插件目录、manifest、skill 子目录、共享资料 | 客户端 marketplace/install 机制的版本差异 |
| MCP | 配置片段、启动脚本、环境变量名、依赖说明 | MCP server npm/pip 包、外部服务 token、外部网络服务 |

## 推荐部署方式

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
