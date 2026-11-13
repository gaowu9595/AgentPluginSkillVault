# Impeccable 首个独立组件验证

日期：2026-11-13。Vault 包版本 1.0.0，上游 Skill 4.8.2，原生引擎 0.1.22，
平台 Windows x64。仅为本次实际检查记录，不代表其他组件也已解耦。

## 已执行

1. 两侧各 64 个上游文件按字节核对，包含 Apache-2.0 LICENSE；Skill 和许可证固定哈希匹配。
2. `test_impeccable_component.py` 最终完整运行 **19 项通过，0 跳过**，耗时 188.201 秒。
   覆盖双端项目安装、用户范围及显式配置根目录、已有原生配置保留、重复安装、中文/空格路径、
   手工安装拒绝覆盖、受管文件修改拒绝、损坏包、目录穿越、目录链接、升级与个人文件冲突、
   一份备份的轮换及修改保护、显式降级、保留个人文件卸载、重复卸载和无效引擎拒绝就绪。
3. 其中真实引擎测试为单独一项，分别为 Claude/Codex 目录安装实际 ZIP，执行 `check`，
   再从各自启动器运行本地 CSS detector，核对 JSON。使用空引擎缓存与指向关闭端口的代理，
   未创建下载缓存。这是本地工具检查，不是操作系统级断网验证。
4. 固定源码和同一 Python/zlib 环境构建到两个独立输出目录，ZIP 哈希一致。
5. 新组件源码、管理脚本、构建和测试未引用 SwitchAI 源码、安装路径或私有数据。
6. 从 Git 暂存内容导出新副本，在 `core.autocrlf=true` 的 Windows 环境重新构建，
   ZIP 和 manifest 哈希仍与发行记录一致。原始快照通过 `.gitattributes` 保留字节，
   组件源码固定 LF；该项验证目录为 `.ui_test/index-checkout-20261113103641`。
7. 新增自有代码/文档的暂存 diff 空白检查通过。原样上游参考文档的现有行尾空白及末尾空行
   保留，未为通过 `git diff --check` 改写快照；检查显式排除两个上游快照目录。

实际执行的核心命令如下；本机使用原生 Python 3.13：

```powershell
New-Item -ItemType Directory -Path .ui_test/tmp -Force | Out-Null
$env:TEMP=(Resolve-Path .ui_test/tmp).Path
$env:TMP=$env:TEMP
$env:VAULT_IMPECCABLE_ENGINE='<已核验的上游impeccable.exe绝对路径>'
python -B -m unittest discover -s tests -p 'test_impeccable_component.py' -v
python -B components/impeccable/build.py --engine $env:VAULT_IMPECCABLE_ENGINE
python -B components/impeccable/build.py --engine $env:VAULT_IMPECCABLE_ENGINE --output .ui_test/rebuild
python -B scripts/validate-components.py --archive dist/components/impeccable/impeccable-1.0.0-windows-x64.zip
```

## 产物身份

- 文件：`dist/components/impeccable/impeccable-1.0.0-windows-x64.zip`
- 字节数：`10477144`（约 9.99 MiB）
- ZIP SHA256：`6092911dabe341c1ed9a635d68e2fd03f3194b7598bc9c504660b74d9cabbc11`
- manifest SHA256：`e6e324ccecf225c16943e0fb192b34608f08e1e8b4a02250d797a0f4f1d26c0c`
- 引擎 SHA256：`4bacf8c756ec3fda3b9fcb69bf1869d4d700ff471be1e31cbff669222dcd8ff2`
- 包内包括固定引擎、Skill/参考资源、上游许可证、独立 PowerShell 管理入口和逐文件清单。
- 发行记录保存于 `registry/releases/impeccable/1.0.0/windows-x64.json`；未上传二进制，
  `downloadUrls` 保持空数组，组件目录标记 `local-only`。

## 发现与修复

- 本机 C: 默认临时目录的最小 Python `rename/replace` 复现 WinError 6，两个 Python
  发行版均出现；E: 仓库临时目录正常。未定位系统级原因。验证显式使用隔离的 E: 临时目录，
  没有用非原子复制替代发布过程；不据此宣称 C: 路径已通过验收。
- 第二次升级轮换备份时，PowerShell 的 `$null` 被 .NET 字符串参数绑定为空字符串，
  `File.Replace` 报路径非法。改用 `[NullString]::Value` 后，针对性升级测试通过，
  随后重新执行上述完整 19 项检查。JSON 输出固定 UTF-8，中文路径检查通过。
- 提交前发现默认 Git 换行归一化会改变上游 CRLF 字节，造成固定哈希与检出副本不符。
  添加 `.gitattributes` 并重新暂存原始字节；上述检出副本构建通过，发行 ZIP 无需变更。

## 未验证范围

没有调用真实模型、读取个人原生配置、连接内网业务或自动注册子 Agent；没有进行
Claude/Codex 原生会话中的 Skill 发现或模型选择检查。安装目录适配与工具检查通过，
不能证明所有客户端版本均兼容。浏览器实时模式、图片生成和完整 UI 审查需要额外工具，
不属于本包的自检。现有 SwitchAI 推荐页、claude-mem 与 Playwright 运行逻辑未迁移。
