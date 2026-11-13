# claude-mem 独立离线组件验证

日期：2026-11-13。范围：Vault claude-mem 1.0.0，Windows x64。
本文按本轮实际运行更新；尚未完成的检查不计为通过。没有上传二进制，
没有调用真实上游模型，也没有进行公司内网业务验收。

## 实现范围

- 复用 claude-mem 15.17.0、Node 24.11.1、Bun 1.4.4 和 SQLite/FTS。
  PowerShell 与包内 Node 管理安装，目标无需 Python 或额外下载。
- 不导入 SwitchAI 源码，不复制其配置、记忆、数据库或原生会话。
- 双端项目 Skill 为 `vault-memory`，MCP 为 `vault_memory`，默认手动保存和检索。
  Claude 自动采集须明确 `enable -Capture`；Codex 自动采集未在本版实现或验证。
- 安装、启用和服务生命周期分开；安装不启动服务，检查不提交模型 turn。
  复用上游 loopback Viewer，没有新建 SwitchAI 界面。
- 共享不可变运行目录，项目记忆位于 Git 外；停止只处理所拥有的进程，卸载保留记忆。

固定构建输入为 312976919 字节，SHA256：
`9e407ea2c0b907bb40c0e77513de7b5fc33a1421596fbdd6cb9c1db0c826495c`。
最终候选 ZIP 为 `claude-mem-1.0.0-windows-x64.zip`，258381073 字节（约 246 MiB），
SHA256 为 `044690d4df0b58a164c1092315c53449aeb503ac6cc7c7abc8ebd41d484a4e43`。
包内 manifest SHA256 为
`9b3f94626d05f0e2765f787026019527a273bf2cc10b5466be2880a255faa355`。
从 Git 索引检出的独立源码副本重新构建，字节数与 ZIP SHA256 完全一致；
证据为 `.ui_test/memory-port-final-build/` 与 `.ui_test/memory-port-final-rebuild/`
下的归档及 sidecar；前者使用 `.ui_test/memory-index-port-final/` Git 索引检出源码。
完整 ZIP、清单与全部成员哈希核验通过：18 项源码、3 个组件、3 条归档记录。
组件台账明确标为本地验证候选，`redistributionReady: false`；二进制未上传。

## 本轮已运行

| 检查 | 实际结果 | 本地证据 |
| --- | --- | --- |
| 管理测试 | 69 项：68 通过，1 项文件符号链接权限跳过，0 失败 | `tests/memory-management.test.cjs`，本轮命令退出 0 |
| 构建测试 | 最终 32 项：31 通过，1 项符号链接权限跳过，0 失败 | `tests/test_memory_build.py` |
| 运行时测试 | 端口补丁前 27 项全部通过；补丁后新增的两个真实生命周期测试通过，无跳过；不是一次全量 29 项运行 | `tests/memory-runtime.test.cjs` |
| 台账测试 | 3 项全部通过 | `tests/test_component_registry.py` |
| 最终端口补丁 ZIP 的真实安装、Worker、Viewer 与 MCP | 实际解压包、全新项目的 7 项旅程全部通过，退出 0，无模型 turn，拥有的 Worker 已停止 | `.ui_test/memory-smoke-port-final/result.json` |
| 前一候选 ZIP 的真实安装、Worker、Viewer 与 MCP | 7 项旅程全部通过，无模型 turn；发生在端口补丁之前 | `.ui_test/memory-smoke-final/result.json` |
| 凭据保护版本采集回放（端口补丁前） | 2 次本机模拟模型请求，1 条 SQLite observation，同一 generation；ACL、首试停止与凭据清理通过 | `.ui_test/memory-capture-20261113-i/result.json` |
| Claude/Codex 原生发现 | 6 项全部通过，没有模型 turn；Job 已关闭 | `.ui_test/memory-native-20261113-04/native-result.json` |
| 同一真实 MCP 连接跨 reader/observer 升级 | 同一 MCP 进程及会话、同一 URL，新 Worker generation；两次保存、三次检索均单次提交成功，81.76 秒，无模型 turn，首试清理成功 | `.ui_test/memory-transition-20261113-a/result.json` |

最终凭据保护版本的 `.h` 回放生成了记忆且通过 ACL 核验，但停止阶段的 Windows CIM 查询
超过 8 秒而失败；没有将该轮记为通过。此前并行运行了构建及生命周期测试。
随后 `.i` 串行回放于 73.35 秒完成，停止首次成功，没有 CIM 超时或重试，
并确认私有目录 ACL 与停止后凭据副本清理。该轮七个适配文件与当时的候选 ZIP 字节一致，
不是新版 ZIP 的采集回放。此后仅 `runtime.cjs` 增加升级端口保留逻辑。
超时与后续结果分别保留在本地证据目录；一次后续通过不证明所有高负载环境均无超时。

两项符号链接跳过均为 Windows 错误 1314；junction、路径穿越、清单完整性与配置冲突
有单独实际检查。这些是针对本组件的检查，不是全仓库测试通过声明。

真实手动旅程先以完整开发暂存包验证（`.ui_test/memory-smoke-dev5`），
再将前一候选 ZIP 解压至 `.ui_test/memory-archive-extracted`，在全新临时项目完整复验通过。
两轮均使用真实上游实现而非模拟 Worker：双客户端安装和启用后，
自检启动并回收自己的 reader；Viewer 返回实际 HTML；真实 MCP 列出七个允许的工具，
`save_memory` 写入后可通过 `search` 检索；MCP 复用同一 Worker PID。
随后停用双端、停止进程并卸载，数据库仍存在，受管 MCP 配置被移除。

端口补丁后的持久 MCP 测试使用开发暂存运行目录，不冒充安装测试。
其记录的七个适配文件哈希已逐一与最终 ZIP 的 manifest 核对一致；同一 MCP bridge 和上游
MCP 子进程在 reader 升级 observer 后保持原进程身份，不重新初始化、不重放保存。
两个定向运行时测试另外验证同端口新 generation，以及端口被其他监听者占用时明确失败，
不随机换端口、不接管或停止其他服务。实际最终 ZIP 的安装证据另列。

最终端口补丁 ZIP 解压至 `.ui_test/memory-port-final-extracted` 后，
在全新 Git 外临时项目运行同一安装夹具，七项检查全部通过，`ok=true`、命令退出 0。
双端安装/启用、自检后回收自己的服务、实际 Viewer HTML、MCP 保存及 SQLite FTS 检索、
同一 PID 复用、停用/停止、卸载保留数据库均通过；没有提交模型 turn。
其结果与前一候选的 smoke 分开存档，没有把旧包检查直接沿用到新包。

采集回放使用真实上游 Worker、真实原生 Claude CLI 2.1.317 和上游内嵌 SDK 0.3.322，
但模型地址与凭据仅来自临时原生配置，指向本机模拟 Anthropic 服务。
没有向外部模型发送会话、代码或测试 turn。测试覆盖 Hook 输入、入队、模型响应解析、
SQLite 写入、同一 Worker generation 复用、原生配置不变和进程回收。
默认发现会跳过不可直接启动的 npm `claude.cmd`，随后正确选择 Claude 安装包内 `claude.exe`；
成功回放没有通过 `--claude-cli` 强行指定路径。
这不等于模型自主使用记忆、真实认证、真实模型表现或内网业务验收。
原生发现另使用 Claude 2.1.317、Codex 0.167.0-alpha.4.1：Claude 发现项目 Skill 并连接
七个 MCP 工具，Codex 配置与 Skill 发现通过；初始化没有发送用户提问或模型 turn。

## 联调发现与修复

1. Windows PowerShell 分离启动在本机直接退出，导致管理命令返回后 Viewer/MCP 失联。
   现由隐藏窗口启动独立 supervisor；启动取消通过持有的进程句柄确认关闭，
   未确认时保留 pending 标记并拒绝重试。短命 Node 调用退出 30 秒后的连接有单独测试。
2. Worker 在创建时通过 Windows Job 属性原子加入 Job，避免创建后、加入前被终止而遗留子进程。
   独立检查验证尚未 Resume 的子进程也随 supervisor 关闭而消失。
3. 显式 Worker URL 会让上游 Hook 选择令牌保护的远程 spool，导致本地事件静默丢弃。
   本机 Hook 现明确使用上游 `filesystem` spool；采集回放已验证实际写库。
4. 自检在同一生命周期锁内启动、探测和清理，仅清理自己创建的 generation，
   不停止已有 observer 或竞争的 MCP reader。等待锁期间撤销采集会重新检查授权。
5. PowerShell Hook 使用原始 stdin 字节转发，避免中文内容被文本管道改码；
   MCP 过滤保留双向请求 ID 的独立语义，防止 `roots/list` 干扰工具清单过滤。
6. 采集凭据仅在私有目录生成；写入前设置并核验仅当前用户与 SYSTEM 可访问的 Windows DACL。
   reader 不加载此文件，确认拥有的进程停止后删除生成的凭据与临时副本，保留记忆。
   活跃 observer、身份不符和未确认的启动状态不会被清理。
7. 已有 MCP 子进程固定使用 Worker URL；reader 升级 observer 如更换随机端口，工具会继续访问旧地址。
   现于完整生命周期锁、身份及连接校验下停止旧代次并复用同一端口；端口冲突明确失败。
   真实持久 MCP 连接和端口冲突检查均已通过，升级期间的失败请求不自动重放。

## 重跑入口

```powershell
python -B -m unittest discover -s tests -p test_memory_build.py -v
node --test tests/memory-management.test.cjs tests/memory-runtime.test.cjs
python -B components/claude-mem/build.py --runtime-archive '<已核验输入归档>'
python -B scripts/validate-components.py --archive '<最终 Vault ZIP>'
```

Windows 生命周期测试需显式提供 `VAULT_MEMORY_TEST_BUN`，私有测试目录通过
`VAULT_MEMORY_TEST_TMP` 指向 Git 外。开发夹具位于 `tests/fixtures/memory_*.py`：
它们使用开发 Python 的 SDK/MCP/pywin32，不导入 SwitchAI；这些依赖不进入目标安装包。
原生初始化、普通 MCP、合成模型回放是独立证据，不能互相代替。

## 分发与剩余边界

源码提交不等于二进制已上传，暂无可宣称可用的下载 URL。
保留 NOTICE、许可证、精确来源及第三方材料，详见
[第三方记录](../../components/claude-mem/THIRD-PARTY.md)。
Bun/JavaScriptCore、Sharp/libvips 的完整对应源码配套、供应方补丁、
部分内联依赖归属与重链接验证仍未完成；功能通过不能证明这些分发义务已经履行。

Office Skills、DesignSession 完整离线依赖、Codex 自动采集、旧数据库迁移、
模型自主选择及真实内网验收均不在本轮完成声明内。
