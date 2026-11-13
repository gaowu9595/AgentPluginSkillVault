# Playwright Test 独立离线组件

Vault 包 **1.0.0**，Playwright Test **1.60.0**，Node **24.11.1**，Chromium **148.0.7778.96 / 1223**。
目标为 Windows x64。目标机需要已有 Claude Code 或 Codex；包内提供 Node、浏览器、测试依赖和许可证，
无需另装 Python/Node，也不在目标机执行 npm 下载。模型服务和业务系统须由用户提供。

## 安装与启用

从可信分发方取得 ZIP，并对照仓库发行记录核对整个 ZIP 的 SHA256，再解压到独立目录。
包内 manifest 只能验证完整性，不能代替可信来源。以下在解压目录的 PowerShell 执行：

```powershell
.\manage.ps1 -Action install -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action check -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action enable -Client claude -Project 'D:\Codes\my-project'
```

Codex 将 `-Client claude` 改成 `-Client codex`。仅支持项目范围；不会修改全局账号、模型、
权限、Hooks 或其他插件。安装和启用分开；自检只访问本地 data 页面，不调用模型或业务系统。
安装、自检可能被 Windows 执行策略、防病毒软件或浏览器运行权限阻止，应保留实际错误排查。

默认共享运行缓存为 `%LOCALAPPDATA%/AgentPluginSkillVault/components/playwright-test/1.0.0`。
可在安装时显式传 `-RuntimeRoot 'D:\AgentComponents'`；实际目录为其下的 `playwright-test/1.0.0`。
多个项目可以复用同一固定版本；项目目录不复制整套浏览器。原生配置包含该运行目录的绝对路径，
移动运行缓存须先停用，使用新位置重新安装、自检和启用。

启用后开启新的原生会话，并保留客户端自身的项目信任、MCP 审批和工具权限提示：

- Claude Code：项目 `.claude/skills/vault-playwright`、三个命名为 `vault-playwright-test-*` 的原生 Agent，
  MCP 名称 `vault_playwright`，注册到项目 `.mcp.json`。可用 `/vault-playwright` 或明确要求使用该技能。
- Codex：项目 `.agents/skills/vault-playwright` 与项目 `.codex/config.toml` 中的同名 MCP。
  可用 `$vault-playwright` 或明确要求使用该技能。三个角色的指令放在 Skill 的 `references/`，
  不声称把 Claude Agent 文件注册成了 Codex 原生 Agent。项目配置需要客户端认可的信任状态；
  本安装器不代替用户授予信任。

已有同名 Skill、Agent、MCP 条目或未受管测试目录时拒绝覆盖。受管文件被修改后，
先保留并处理差异再更新/移除；不以“接管”名义覆盖个人配置。JSON 保留其他配置值；
Codex 的 TOML 采用结构化解析及独立管理块，保留块外内容。若原配置使用不能安全追加的
内联 MCP 表或已有同名管理标记，则保留原文件并报错，不自动重写整份文件或删除注释。

## 执行已有用例

准备业务 URL、授权登录方式、前置条件和完整用例。已有 TP Skill 可以继续读取用例；
本包不附带公司 TP Skill、账号、数据或业务知识。对话示例：

> 使用 vault-playwright，先读取 TP 给出的完整用例并确认前置条件。
> 已有可运行脚本就先执行，缺失时再生成。保留截图、录像、Trace 和实际报告，
> 报告产品缺陷，不允许用跳过或削弱断言变成通过。

测试内容位于项目 `.agent-vault-tests`：`specs/` 为计划和修复记录，`tests/` 为测试脚本，
`runs/<run-id>/` 为不可混淆的分次执行证据。测试从 managed `fixtures.ts` 导入 `test/expect`，
运行时直接使用包内依赖，适用于含 `type:module` 的项目。

默认 seed 只负责打开授权业务 URL，不能作为业务通过证据。用环境变量传入业务地址：

```powershell
$env:VAULT_TEST_BASE_URL = 'http://your-authorized-test-system'
$vaultRuntime = (Get-Content .agent-vault-tests/.vault-workspace.json -Raw | ConvertFrom-Json).runtimeRoot
& (Join-Path $vaultRuntime 'bin/node.exe') (Join-Path $vaultRuntime 'scripts/run.cjs') --project (Get-Location).Path -- '.agent-vault-tests/tests/example.spec.ts'
```

需从项目根目录执行，并将示例文件换成实际用例。若要自定义登录与初始化，另建个人 seed，
为 planner/generator 显式传入其路径；保留受管 seed/config/fixture。登录状态文件放 `.auth/` 等
被忽略的位置，不把凭据提交 Git。MCP 可执行浏览器动作；路径约束只覆盖计划和测试文件输出，
不是对目标网站、脚本或操作系统的整体沙箱。

也可由用户或当前任务将授权地址写入被忽略的 `.agent-vault-tests/environment.local.json`，
格式为 `{"baseURL":"http://your-authorized-test-system"}`，便于 MCP 与命令重放使用同一地址。
每次加载测试配置时读取该文件；环境变量优先。不要将账号、登录状态或该私有文件提交 Git。

正式验收使用 `scripts/run.cjs` 做最终重放。它保留真实进程退出码，产出 JSON/HTML 报告，
截图、录像和 Trace 默认保留；零用例、跳过、flaky 或报告错误不会被总结为全部通过。
MCP 交互、安装成功、浏览器自检均不代替业务验收。报告中仍须列出实际用例与证据。

## 状态、停用、升级和卸载

```powershell
.\manage.ps1 -Action status -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action disable -Client claude -Project 'D:\Codes\my-project'
.\manage.ps1 -Action uninstall -Client claude -Project 'D:\Codes\my-project'
```

所有管理命令输出一个协议 1 JSON；失败返回非零退出码。`status` 是轻量状态读取，
不会每次扫描浏览器或执行模型；`check` 才核验安装文件并实际启动浏览器。
停用/卸载只修改本客户端后续会话的加载，不中断已经运行的原生会话；先结束旧会话再执行新任务。
卸载保留用例、报告、私人附加文件和共享运行缓存，避免损坏其他项目；不提供自动删除共享缓存操作。

升级先停用使用该项目的客户端，再用新包安装、自检和启用。运行包按版本并存，不覆盖旧版本。
恢复旧版本使用保留的可信旧 ZIP 重新安装；若受管配置已自行更改，保留现场并手动迁移，
不承诺任意版本的数据都能自动回滚。不会读取或迁移 SwitchAI 的 `.switchai-tests`、数据库或私有设置。

## 构建与来源

构建机使用 Python 标准库，并显式提供已准备、校验过的运行依赖 ZIP：

```powershell
python -B components/playwright-test/build.py --runtime-archive '<准备好的playwright-test-component.zip绝对路径>'
python -B -m unittest discover -s tests -p 'test_playwright_build.py' -v
node --test tests/playwright-management.test.cjs tests/playwright-demo.test.cjs
```

`component.json` 固定源 ZIP 身份；`UPSTREAM.json` 保留来源和本地适配说明。
该 ZIP 作为准备好的依赖输入，不要求构建机安装或读取 SwitchAI 源码。
上游运行库、浏览器与许可证复用；Vault 新增管理器、配置适配和证据重放入口。
原始官方 Agent 文件保存在 `upstream-agents/`，必要的前缀/目录/诚实失败适配保存在 `agents/`。
TOML 解析使用固定的 smol-toml 1.6.0（BSD-3-Clause），保留原样模块和许可证。
完整演示见仓库 `examples/playwright-regression/README.md`；验证范围见相应发行报告。
