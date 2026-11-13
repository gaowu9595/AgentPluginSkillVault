# claude-mem 独立离线组件

Vault 候选版本 **1.0.0**，目标为 Windows 10 / Windows Server 2016 及以上 x64；上游 **claude-mem 15.17.0**，
Node **24.11.1**、Bun **1.4.4**，SQLite/FTS 配置。
本地验证候选包；实际功能、归档校验与未验证范围见报告；源码提交不代表二进制或源码配套已上传。
以下说明管理接口与使用流程；最低系统要求不代表所有系统版本均已实测。
计划见 [独立化计划](../../docs/plans/2026-11-13-claude-mem-independent.md)，
[验证报告](../../docs/reports/2026-11-13-claude-mem-independent.md) 区分实际运行与未验证范围。

运行包提供 Node、Bun、上游插件、Worker、Viewer 和依赖/许可证，目标机无需 Python，
无需另装 Node/Bun 或运行 npm 下载。使用原生接入需已有 Claude Code 或 Codex；
手动保存、检索和查看不需要观察模型，自动采集整理才使用已有 Claude 模型连接并可能消耗额度。
不导入 SwitchAI 源码，不读取、复制或迁移其私有配置、数据库、记忆或原生会话。

## 安装与手动记忆

从可信来源取得 ZIP 与公布的校验值，按随包发行记录（sidecar）核对版本、字节数和 SHA256 后解压。
包内 manifest 只能证明文件完整性，不能代替可信的整个 ZIP 校验值。
以下命令在解压目录执行，项目必须是已有目录，参数使用绝对路径：

```powershell
.\manage.ps1 -Action install -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action check -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action enable -Client claude -Project 'D:\Codes\my-project'
```

Codex 将 `-Client claude` 换成 `-Client codex`。安装不启用 Hooks、不启动服务、不调用模型；
普通 `enable` 仅登记该项目的手动保存/检索能力，也不会发起模型请求。
在该项目目录开启新的 Claude Code 或 Codex 会话，完成客户端自己的项目信任、MCP 审批和工具权限流程。

| 客户端 | 项目 Skill | 项目 MCP 配置 | 本版自动采集 |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/vault-memory` | `.mcp.json` 中的 `vault_memory` | 仅显式 `enable -Capture` |
| Codex | `.agents/skills/vault-memory` | `.codex/config.toml` 中的 `vault_memory` | 不提供；原生机制研究/验证另行开展 |

Claude Code 使用 `/vault-memory`，Codex 使用 `$vault-memory`，也可以明确要求使用该技能。
先检索已有记录，再要求“记住本项目采用的接口约定，并注明依据”；按 MCP 实际 schema 保存，成功以工具返回为准。
随后可在新的项目会话中要求“检索已保存的接口约定并列出来源”，确认所需事实及适用范围。
这是项目级 claude-mem 记录，不等于原生 Claude/Codex 记忆，也不替代仓库权威文档。
手动保存和检索不自动导入旧对话、其他项目或既有记忆数据库。

## Claude 自动采集

自动采集仅适用于 Claude Code，且必须明确选择。以下流程用于已为 Claude 安装组件的项目；
先停用 Claude 手动接入，若 Codex 也已启用本项目记忆，同样先用 `-Client codex` 停用，
再选择已有原生 Claude 配置目录并启用采集：

```powershell
.\manage.ps1 -Action disable -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action configure -Client claude -Project 'D:\Codes\my-project' -ClaudeHome 'D:\NativeClaude'
.\manage.ps1 -Action enable -Client claude -Project 'D:\Codes\my-project' -Capture
```

`configure` 只接受连接选择参数 `-ClaudeHome`，不接受密钥、模型或 API URL 输入，也不改原生账号、
模型设置；不能用它移动数据。适配器只从选定 Claude home、项目设置及允许的环境变量解析连接字段，
不执行 `apiKeyHelper`，不回显密钥，不能从“配置存在”推断认证有效。
已有订阅登录仍由原生 Claude 处理，未支持的连接须明确报错后由用户处理。

显式授权采集后，启动 observer 时可将允许的连接环境字段写入
`<项目私有数据目录>/native-empty/observer.env`，以遵循上游的凭据查找方式。
该文件可能包含凭据，位于 Git、项目和共享运行包之外；不要提交或随运行包分发。
reader 不生成或加载此文件，手动记忆、查看与自检不因此获得观察模型凭据。
写入前先限制私有目录和已有凭据文件的 Windows DACL，仅允许当前用户与 SYSTEM 访问；
无法确认权限时拒绝写入。确认拥有的 worker 停止后，清理 `observer.env` 及其受管临时副本，保留记忆数据库。

`enable -Capture` 显式允许向项目 `.claude/settings.json` 注册受管的上游事件 Hooks；
后续原生会话事件才可触发观察模型整理。它不修改全局设置，不重写原生连接，也不代用户授予权限。
从手动模式切换为采集模式，先 `disable` 再 `enable -Capture`。
Codex 的 `-Capture` 在本版拒绝，不能把 MCP 注册、手动写入或原生发现宣称为 Codex 自动采集。

## 查看、服务与自检

```powershell
.\manage.ps1 -Action status -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action viewer -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action stop -Client claude -Project 'D:\Codes\my-project'
```

`viewer` 返回本机 loopback Viewer URL，复用上游页面，无新建宿主 UI；不向局域网公开服务。
在浏览器打开命令返回 JSON 中的 `viewerUrl`，查看本项目已保存的记忆。
`start` 默认启动 reader（observer 关闭），`viewer` 使用同一方式准备查看服务。
二者不启用采集；若已有采集 worker，读取会复用它，不通过查看操作强制降级或中断已有采集。
`check` 核验安装文件并检查本地上游 worker，不提交模型 turn；自检不等于实际观察模型或业务验收。
查看记录不应在上游页面重新开启宿主管理之外的云同步、自动更新、Chroma 或其他服务。

`stop` 只停止本组件拥有的项目 worker，不按进程名清理系统进程；仍启用的 Hooks/MCP 桥接可能在之后重启它。
需要停用能力时执行 `disable`，受管状态先失效，使旧 Hooks 不能再次启动采集。
两端共享本项目数据；单端停用不代表另一端已停用，也不终止既有原生会话。

| Action | 当前接口行为 |
| --- | --- |
| `install` | 校验并准备共享运行文件及客户端项目状态；不启动服务/采集 |
| `status` | 查看安装、启用及受管服务状态；不证明模型可用 |
| `check` | 文件完整性及本地 worker 自检；不调用模型 |
| `enable` / `disable` | 登记/移除当前客户端的项目 Skill、MCP 及显式授权的 Claude Hooks |
| `configure` | 用 `-ClaudeHome` 选择已有原生连接来源；两端需先停用 |
| `start` / `stop` | 启动 reader / 停止拥有的 worker；与原生启用状态分开 |
| `viewer` | 返回上游 Viewer 的本机 URL |
| `uninstall` | 移除当前客户端受管接入及状态，保留记忆和共享运行缓存 |

管理命令输出单个协议 1 JSON；失败返回非零退出码。安装、启用、运行中、自检通过和模型可用是不同状态。

## 数据、参数与移除

| 参数/位置 | 含义 |
| --- | --- |
| `-Project` | 绝对项目路径，`-Client` 为 `claude` 或 `codex`，只支持项目范围 |
| `-RuntimeRoot` | 可选共享缓存基目录，实际版本目录在其下 `claude-mem/1.0.0` |
| 默认运行目录 | `%LOCALAPPDATA%/AgentPluginSkillVault/components/claude-mem/1.0.0`，不可变版本、跨项目复用 |
| `-DataRoot` | 安装时可选私有数据基目录；必须在 Git、项目和运行包之外 |
| 默认数据基目录 | `%LOCALAPPDATA%/AgentPluginSkillVault/data/claude-mem`，再按规范化项目路径的 key 隔离 |
| 私有观察配置 | 仅显式采集启动 observer 时可写入项目私有数据目录中的 `native-empty/observer.env`；reader 不生成或加载 |
| `-ClaudeHome` | 可选原生 Claude home；`configure` 只切换此来源，不创建模型连接 |
| 项目状态 | `.agent-vault/claude-mem/<claude或codex>/project.json`，记录运行/数据位置与接入所有权 |

同一项目的两端使用相同运行目录、私有数据基目录和 Claude home，启用状态各自独立。
更换这些安装路径前先停用；不自动迁移数据库。版本/数据/配置关系不明时保留现场并处理冲突。
重复的原生 claude-mem、未受管的同名 Skill/MCP/Hooks 或修改过的受管文件会阻止覆盖和移除；
不要再装一份来绕过冲突，不把凭据和私有数据库写入 Git。

```powershell
.\manage.ps1 -Action disable -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action uninstall -Client claude -Project 'D:\Codes\my-project'
```

卸载保留用户记忆、私人文件和共享运行缓存，不自动删除旧数据库或提供跨版本数据回滚承诺。
备份私有数据前先停用使用它的客户端并停止受管 worker；恢复或迁移须另行确认兼容性。

## 构建与验证边界

来源、固定依赖与许可证见 [component.json](component.json) 和 [UPSTREAM.json](UPSTREAM.json)。
构建器显式接收已准备的固定归档，核验后选择上游运行字节，去除旧宿主 launcher，另打包 Vault 适配器和双端 Skill；
不要求存在 SwitchAI 源码。SQLite/FTS 之外的 Chroma、云同步及自动更新不属于此离线配置。

```powershell
python -B components/claude-mem/build.py --runtime-archive '<已核验的准备归档绝对路径>'
```

这是从仓库根目录执行的开发构建命令，Python 不进入目标运行依赖。
实际功能、归档校验、独立检出重建与未验证范围见
[验证报告](../../docs/reports/2026-11-13-claude-mem-independent.md)。开发验证使用
[smoke 夹具](../../tests/fixtures/memory_smoke.py)、[采集夹具](../../tests/fixtures/memory_capture.py)及
[原生初始化夹具](../../tests/fixtures/memory_native.py)，与目标运行依赖分开。
smoke 不提交模型 turn；loopback 采集夹具使用本机响应，不构成上游模型连接或内网业务验收。
局部夹具、原生初始化、观察模型调用与内网验收分别记录；
本包不提供模型服务、公司账号或业务数据。依赖许可证、固定源码引用和源码配套状态见
[第三方说明](THIRD-PARTY.md)；功能验证不表示对应源码与重新链接义务已履行，源码提交不代表配套已上传。
