# Playwright 独立组件验证记录

日期：2026-11-13。范围为独立 Vault 组件与本地回归演示；SwitchAI 工作树仅供只读核对，
没有修改其运行服务或界面。以下结果来自本轮执行，未借用旧报告的测试计数。

## 本机发行物

- `playwright-test` / Vault `1.0.0` / Windows x64 / manifest 与管理协议 `1`。
- Playwright Test `1.60.0`，Node `24.11.1`，Chromium `148.0.7778.96`、修订 `1223`。
- ZIP：`dist/components/playwright-test/playwright-test-1.0.0-windows-x64.zip`。
- 字节数：`347895174`。
- ZIP SHA256：`3a87840a7a0edebd2a157fdf7c0326eb48e8252212c930716df915dc5f545a94`。
- manifest SHA256：`ec064173472ff1ddbfc77af26128bde77b661d0c594718051f7adbce8ff11352`。
- 逐文件来源、原始与适配 Agent 哈希、许可证和确定性压缩规则在
  [UPSTREAM.json](../../components/playwright-test/UPSTREAM.json)。
- ZIP 仅在本机生成，未上传 GitHub Release 或内网；下载地址留空。

## 已执行的源码检查

| 命令 | 本轮实际结果 |
| --- | --- |
| `node --test tests/playwright-management.test.cjs tests/playwright-demo.test.cjs` | 34 通过，0 失败、跳过；127.033 秒 |
| `python -B -m unittest discover -s tests -p test_playwright_build.py -v` | 24 项中 23 通过，1 跳过；39.170 秒 |
| `python -B -m unittest discover -s tests -p test_component_registry.py -v` | 3 通过，0 失败；0.821 秒 |

构建用例跳过的是当前 Windows 用户没有创建文件符号链接的权限（错误 1314）；
实际目录联接的拒绝检查通过。上述为定向检查，不是整个仓库测试套件。
Node 使用本机 `G:/nodejs/node.exe`，构建工具使用 Python 3.13；这些是开发环境，
不构成目标用户必须安装 Node/Python 的前置条件。

只读代码复核发现并修复了：生成工具覆盖受管 seed、Windows 大小写别名绕过保护、
证据目录跟随目录联接、共享工作区升级后旧客户端仍引用旧运行版本，以及两个初始化
工具被上游标为只读。相应回归与实际生成工具的针对性复核通过。未改上游运行库字节。

## 安装后的验证

实际解压根：`.ui_test/playwright-package-20261113-01`。
回归目录：`.ui_test/playwright-demo-20261113-01`。
原生发现目录：`.ui_test/playwright-native-20261113-01`。
Git 检出重建：`.ui_test/playwright-checkout-20261113-02`，输出
`.ui_test/playwright-rebuild-20261113-02`。

这些目录为被忽略的本机证据，不包含在源码提交或离线发行包中。

浏览器回归由包内 Node 执行仓库的
[demo.cjs](../../examples/playwright-regression/demo.cjs)，显式传入 `--component` 和
`--output`。只安装一次，在中文、空格路径和 `type:module` 项目中重放同一份七条用例：

| 轮次 / run-id | 通过 | 失败 | 跳过 / flaky | 实际退出码 |
| --- | --- | --- | --- | --- |
| 缺陷 / `run-1794542474229-2016a968` | 5 | 2（TC04、TC05） | 0 / 0 | 1 |
| 修复 / `run-1794542657253-b1412caf` | 7 | 0 | 0 / 0 | 0 |

两轮业务脚本 SHA256 均为
`87943927fb3c545a903b9619608782e5531b9b1221cccffd0bf1e9ce6e280056`。
没有修改断言、跳过、预期失败或重试来变绿。每轮有 JSON/HTML 报告、11 张截图
（含 4 张主题/尺寸截图）、7 段录像、7 个 Trace；驱动检查了媒体存在性、文件头及证据路径。
完整摘要、原始日志和报告留在上述回归目录的 `demo-summary.json`、`*.log` 与项目 `runs/`。

从解压包通过 PowerShell `manage.ps1 -Action check -Client claude -Project <临时项目>`
执行真实浏览器自检，返回 `ready`：浏览器启动、本地页面断言、截图及文件完整性通过，
Node `24.11.1`、Playwright `1.60.0`、Chromium `148.0.7778.96`。

原生验证使用 [playwright_native.py](../../tests/fixtures/playwright_native.py)，
显式指定两个解压包、输出目录和两个原生 CLI。它仅依赖开发环境中的
`claude-agent-sdk 0.2.168`、`mcp 1.30.0`、`pywin32 312`，不导入 SwitchAI 源码；
本机恰好复用现有开发虚拟环境的这些库，不是安装或运行组件的前置条件。
实际 CLI 为 Claude Code `2.1.317`、Codex `0.167.0-alpha.4.1`。
使用隔离配置根、临时 Git 项目和 `http://127.0.0.1:1` 模型地址，5 项检查全部通过：

- 两端项目安装与显式启用。
- Claude SDK 初始化发现 `vault-playwright`、三个 `vault-playwright-test-*` 原生 Agent、
  `impeccable`，项目 MCP 连接成功并发现 84 个工具。
- 直接 MCP 协议发现同样 84 个工具，六个写入/执行工具的 `readOnlyHint` 均为 false；
  实际 `generator_write_test` 写受管 seed 被拒绝，seed 前后哈希一致。
- Codex `mcp get vault_playwright --json` 实际读取项目 TOML；临时用户配置只含项目测试信任。
- Codex app-server `skills/list` 发现启用的项目 `vault-playwright` 和 `impeccable`。

没有发送模型回合。证据为 `native-result.json`；Windows Job 已关闭、worker 退出码 0，
仅回收该 fixture 拥有的进程树。原生权限测试信任只写在隔离配置根中，未改变个人配置。

Git 索引检出副本的完整重建与首包逐字节身份一致：大小、ZIP SHA256 和 manifest SHA256
均与上文相同。初次检出准备发现许可证换行转换，已通过 `.gitattributes` 保留原始字节；
取消该次未发布重建，从新的检出目录完成验证。源 ZIP 输入显式给定，完整输入和原 manifest
成员均经过构建器核验。没有发布压缩级别 9 的试验包。

实际检查了桌面 `1280x800`、窄屏 `390x844` 的浅/深主题截图，长文本换行且操作按钮可见，
未发现遮挡或横向溢出。持久化的修复轮截图为
[桌面浅色](../assets/playwright-regression-20261113/desktop-light.png)、
[桌面深色](../assets/playwright-regression-20261113/desktop-dark.png)、
[窄屏浅色](../assets/playwright-regression-20261113/mobile-light.png)、
[窄屏深色](../assets/playwright-regression-20261113/mobile-dark.png)。
本地检查不代表用户验收；演示设计由执行代理使用 Impeccable 审查，控制器复看实际截图。

最终分别用 `scripts/validate-components.py --archive <ZIP>` 检查 Playwright 与既有
Impeccable 包，两次均返回 `ok: true`，台账为 16 项源码、2 个组件、2 条发行记录。
校验覆盖实际 ZIP 大小/哈希、manifest、成员列表及每个文件哈希。既有 Impeccable
整套隔离测试未重跑；本轮覆盖其档案校验、双端原生发现与通用台账兼容回归。
暂存内容检查未发现安装运行二进制、私有数据或凭据模式；差异空白检查明确保留上游
Agent/vendor 原始字节，并将保留的 CRLF 许可证按 `cr-at-eol` 核对。

## 范围与限制

本地浏览器回归、客户端发现、模型自主选择和内网业务验收是不同证据。
本轮没有向真实模型提交任务，不证明模型能自主完成所有测试，也未接入公司 TP、
业务系统、账号、测试数据或内网环境。Codex 中三个角色是 Skill 参考资料，
不是注册为 Codex 原生子 Agent。MCP 路径约束不是操作系统沙箱。

既有 SwitchAI Playwright、claude-mem、团队及记忆专用界面没有迁移。
管理器仅影响显式启用的项目和客户端，不改账号、模型、Hooks、权限或全局配置；
原生会话仍遵循客户端自身的信任与审批。卸载保留测试、报告、私人文件及共享运行缓存。
