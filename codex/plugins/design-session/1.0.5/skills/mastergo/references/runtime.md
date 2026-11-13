# 导出辅助脚本

脚本路径相对于本技能目录；先解析技能目录的绝对路径再运行，不依赖项目 CWD。Node >= 18，Playwright/Chromium 或已安装 Chrome/Edge。

Windows 使用 PowerShell 入口，自动从 Process/User/Machine 读取已有 `MG_MCP_TOKEN`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '<技能目录>/scripts/fetch_mastergo.ps1' -Url 'https://seerdesignmg.sangfor.com/file/202966196127495?page_id=2%3A1&layer_id=4%3A31387' -OutDir '<本次输出目录>'
```

跨平台或进程已有凭据时：

```bash
node '<技能目录>/scripts/fetch_mastergo.cjs' --url 'https://mastergo.com/file/123?page_id=2%3A1&layer_id=4%3A2' --out-dir '<本次输出目录>'
```

默认 `all` 保存结构和 PNG；已有 MCP 原始结构时可用 `-Mode png`/`--mode png` 避免重复请求接口。`structure` 仅取结构，不证明取得图片。`-Plan`/`--plan` 仅解析目标，不联网。exit 0 表示请求模式完整成功，2 表示部分成功/阻塞/需要选择目标；读取 manifest 后决定，不盲目重试。

| PowerShell 参数 | Node 参数 | 用途 |
|---|---|---|
| `-LayerId` / `-PageId` | `--layer-id` / `--page-id` | 明确范围；不修改设计稿 |
| `-PlaywrightModule` | `--playwright-module` | 已存在的 playwright/playwright-core 包目录或模块入口 |
| `-BrowserPath` | `--browser-path` | Chrome/Edge/Chromium 可执行文件 |
| `-ProfileDir` | `--profile-dir` | 专用持久浏览器配置；避免同时打开造成锁冲突 |
| `-TimeoutMs` | `--timeout-ms` | 每个浏览器等待上限，默认 90000 毫秒 |
| `-IgnoreHttpsErrors` | `--ignore-https-errors` | 明确的企业证书错误，仅影响本次导出 |

可选环境变量：`MASTERGO_PLAYWRIGHT_MODULE`、`MASTERGO_BROWSER_PATH`、`MASTERGO_BROWSER_PROFILE`；`MASTERGO_API_TOKEN` 是进程凭据备选。默认配置目录位于 `$CODEX_HOME/mastergo-browser/<origin-hash>`，未设置 CODEX_HOME 时使用用户 `.codex`。

成功读取后将已验证的浏览器配置/依赖路径按站点写入 `$CODEX_HOME/mastergo/runtime.json`（无 CODEX_HOME 时为用户 `.codex`）。下次自动复用；命令行参数及环境变量优先。这里只保存非敏感路径，不保存 token、不跨站点复用登录配置。全新配置无法加载时，可先检查历史导出工具的 `profileDir`，用 `-ProfileDir` 验证并由脚本记住。

本地 API 与官方 magic-mcp 的只读接口一致：`/mcp/design-sections?fileId=...&layerId=...`；旧服务器返回 404/501 才退到 `/mcp/dsl`。鉴权头为 `X-MG-UserAccessToken`，只对用户指定设计站点同源请求添加。浏览器节点通过 `window.mg.getNodeById` 定位；完整等待节点就绪后执行 `window.mg.exportPng`，验证 PNG 签名、尺寸和尾部，记录 SHA-256。

`design-sections.json` 可能只是索引；`runtime-structure.json` 标明选中子树的实际节点数。这里只声明本次返回/导出的范围，不冒充整文件覆盖。API 失败仍尝试浏览器；浏览器失败保留已取得的结构和失败原因。

修复时先看 manifest：模块缺失则发现现有依赖或安装本地 `playwright-core`，浏览器缺失则指向已有 Chrome/Edge；未加载 `window.mg` 则检查登录、权限、网络和企业证书。不要复制请求头或输出 token。代理需求使用现有网络配置或可用的 browser-proxy-access 技能，不把网络失败归因于设计文件不存在。
