# 独立浏览器回归演示

这是可以直接打开的简体中文任务清单，以及预写业务用例、真实 Playwright 测试和离线回放驱动。
仅依赖已解压或已安装的 Vault Playwright Test 组件，不依赖 SwitchAI、全局 npm、模型或外部服务。

## 应用与业务输入

直接打开 [index.html](index.html) 即可操作修复版本；页面不需要 Web 服务器或下载资源。
任务只在当前页面会话内存在，刷新清空。支持添加、完成与恢复、筛选、删除和浅深系统主题。
完整业务规则、输入、步骤、预期和判定标准见 [cases.md](cases.md)；
对应的七条浏览器用例在 [task-regression.spec.ts](task-regression.spec.ts)。

`task-model.js` 保留一处可复现的产品缺陷。缺陷模式和修复模式的差别是这一行：

```diff
- const title = input;
+ const title = input.trim();
  if (!title) return { ok: false, error: '请输入任务名称' };
```

缺陷模式既接受纯空白名称，也保留不应保存的首尾空白。默认直接打开的是修复模式；
驱动的两个临时 loopback 服务器分别提供缺陷与修复配置，其他应用文件相同。
配置由服务器提供给应用，测试不读取该模式、不按模式分支。

## 离线运行

在 Windows x64 的 PowerShell 中，将组件路径替换为真实的解压/安装目录。
该目录须包含 `bin/node.exe`、`scripts/manage.cjs`、`scripts/run.cjs` 及完整浏览器运行载荷。
组件和输出参数必须为绝对路径。输出目录的父目录须存在；输出必须是本机任意可写盘上
尚不存在的新目录，不能放在组件目录内。下面的变量由使用者按自己的路径设置：

```powershell
$vaultRepo = (Resolve-Path '<Vault 源码目录>').Path
$demoComponent = (Resolve-Path '<组件解压或安装目录>').Path
$demoOutput = Join-Path ([System.IO.Path]::GetTempPath()) ('vault-playwright-demo-' + [guid]::NewGuid().ToString('N'))
& (Join-Path $demoComponent 'bin/node.exe') (Join-Path $vaultRepo 'examples/playwright-regression/demo.cjs') --component $demoComponent --output $demoOutput
```

驱动仅安装一次，执行接口如下；安装返回的 `runtimeRoot` 是实际版本目录，后续使用该目录的 Node 和脚本：

```text
<component>/bin/node.exe <component>/scripts/manage.cjs --action install --client claude --project <output>/任务 工作区 --runtime-root <output>/runtime
<installed>/bin/node.exe <installed>/scripts/run.cjs --project <output>/任务 工作区 -- task-regression.spec.ts --workers=1 --retries=0
```

同一个含空格和中文路径的 ESM 项目连续运行两次，共享同一份安装和浏览器，不重复复制浏览器。
`VAULT_TEST_BASE_URL` 仅通过各次子进程环境传入。服务器绑定随机的 `127.0.0.1` 端口，
由驱动进程持有并在 `finally` 中关闭；测试进程由安装组件持有。
驱动对超时或中断仅清理自己启动的 PID 进程树，从不按进程名终止程序。

安装只准备工作区，不执行 enable、不注册 MCP、不启用模型或 Hooks。
业务 spec 在安装之后复制到 `.agent-vault-tests/tests/`，属于用户文件，
不加入组件所有权清单；卸载应保留它、用例文档及所有运行证据。
驱动不自动卸载或删除输出目录，方便复查。

## 结果与证据

驱动 stdout 和 `<output>/demo-summary.json` 提供机器可读汇总。
每个子进程的原始输出保留为 `<output>/{install,broken,fixed}.{stdout,stderr}.log`。
只有同时满足以下条件才返回退出码 0：

- 缺陷轮：7 总计、5 通过、2 失败、0 跳过、0 重试；仅 TC04、TC05 的业务断言失败，进程退出 1。
- 修复轮：7 总计、7 通过、0 失败、0 跳过、0 重试，进程退出 0。
- 两轮的业务 spec SHA256 相同，且与仓库中的源文件相同。
- 两轮使用不同的 `.agent-vault-tests/runs/<id>/`，有真实 `results.json` 和 `html/index.html`。
- 每条用例的报告附件均指向该轮目录内存在、非空且文件头正确的 PNG、WebM、trace ZIP。

固定使用组件生成的 fixture 和配置，测试导入 `./fixtures` 的 `test/expect`。
不覆盖 reporter、不降级证据设置、不改断言、不使用跳过、预期失败或重试来变绿。
即使修复轮失败，汇总仍保留已产生的真实数量、失败用例和证据位置；驱动返回非零。
TC07 另附桌面/窄屏 × 浅色/深色四张实际应用截图，供人工检查排版。

## 本地逻辑检查

```powershell
node --test (Join-Path $vaultRepo 'tests/playwright-demo.test.cjs')
```

这些 Node 单元测试验证业务规则、loopback 服务生命周期、CLI 参数和报告拒绝规则，
不启动浏览器，也不代替上述完整回放。报告拒绝规则的合成对象仅用于单元测试，
驱动从安装组件生成的实际报告和附件读取结果，不生成模拟浏览器证据。

此演示证明的是本机离线浏览器回归。Claude/Codex 模型发现、模型选择、MCP 调用、
TP 导入、内网系统和真实公司业务验收均不在此演示的验证范围内。
