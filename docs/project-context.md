# Current Project Context

Snapshot: 2026-11-13. Vault is independent of SwitchAI and publishes separately.
Read [AGENTS.md](../AGENTS.md), [component rules](component-rules.md), and
[version policy](component-versioning.md) before implementing changes.

The existing DesignSession 1.0.5, Office Skills and MasterGo launcher remain source
snapshots. Their runtime dependencies are not automatically provided by this repo.
Impeccable is the first complete Windows x64 offline component: Vault 1.0.0,
upstream Skill 4.8.2, native engine 0.1.22. See the
[component guide](../components/impeccable/README.md) and
[fresh validation report](reports/2026-11-13-impeccable-component.md).

Playwright Test 1.0.0 is a locally verified, local-only release targeting Windows
x64 with Playwright 1.60.0, bundled Node 24.11.1 and Chromium 148.0.7778.96 / 1223.
It is recommended in the local component catalog; no binary has been uploaded.
See the
[component guide](../components/playwright-test/README.md),
[adaptation inventory](adaptation-inventory.md), and
[verification report](reports/2026-11-13-playwright-independent.md) and
[release record](../registry/releases/playwright-test/1.0.0/windows-x64.json).
The verified ZIP contains 347895174 bytes, SHA256
`3a87840a7a0edebd2a157fdf7c0326eb48e8252212c930716df915dc5f545a94`;
manifest SHA256 is
`ec064173472ff1ddbfc77af26128bde77b661d0c594718051f7adbce8ff11352`.
An independent second build from a Git-index checkout reproduced the ZIP hash.

## claude-mem 独立化候选

当前分支 `codex/claude-mem-vault-offline` 已完成候选 `claude-mem 1.0.0` 的独立化与本地功能验证，
目标为 Windows 10 / Windows Server 2016 及以上 x64，上游 `15.17.0`、Node `24.11.1`、Bun `1.4.4`、SQLite/FTS。
状态为 `local-verification-candidate`、`redistributionReady=false`；
第三方完整源码配套尚未交付，未宣称完成公开二进制发行；本地功能验证与公开再分发状态分开记录。
见 [组件说明](../components/claude-mem/README.md)、
[独立化计划](plans/2026-11-13-claude-mem-independent.md) 和
[验证报告](reports/2026-11-13-claude-mem-independent.md)；实际检查范围与限制以报告为准。
新归档的版本、字节数、ZIP 与 manifest 校验值以候选 [归档记录](../registry/releases/claude-mem/1.0.0/windows-x64.json) 为准。
端口补丁后已完成新 ZIP 的独立重建、完整归档核验及实际安装旅程。二进制未上传，源码提交也不代表源码配套已上传。

管理接口为 `install/status/check/enable/disable/uninstall/configure/start/stop/viewer`，
`-Client claude|codex -Project <绝对路径>`；安装可选 `-RuntimeRoot` 共享基目录、
`-DataRoot` 私有基目录、`-ClaudeHome` 原生配置目录。默认运行目录为
`%LOCALAPPDATA%/AgentPluginSkillVault/components/claude-mem/1.0.0`；默认私有数据基目录为
`%LOCALAPPDATA%/AgentPluginSkillVault/data/claude-mem`，按项目 key 隔离，位于 Git 与运行包之外。
客户端状态为 `.agent-vault/claude-mem/<client>/project.json`；卸载保留记忆和共享运行缓存。

`install` 不启用 Hooks、不启动服务、不调用模型。普通 `enable` 为两端登记项目
`vault-memory` Skill（`.claude/skills` 或 `.agents/skills`）和 `vault_memory` MCP，提供手动保存/检索。
仅 Claude 显式 `enable -Capture` 才允许上游采集 Hooks；Codex 本版不提供自动采集，原生机制研究/验证另行开展。
`configure -ClaudeHome` 只选择已有 Claude 连接的允许字段，不接受密钥 CLI 输入，不重写原生模型/账号设置，
不运行凭据 helper；修改连接来源前先停用两端。目标无需 Python，观察模型仅在自动采集时需要。
显式采集启动 observer 时可将允许的连接环境字段写入 Git 外的
`<项目私有数据目录>/native-empty/observer.env`，遵循上游凭据查找方式；
该文件可能含凭据，不进入共享运行包，reader 不生成或加载它。
写入前设置并核验 Windows 私有 DACL，仅允许当前用户与 SYSTEM；权限无法确认时拒绝写入。
确认拥有的 worker 停止后清理 `observer.env` 及其受管临时副本，保留记忆数据库。

`start` 默认启动 reader，observer 关闭；`viewer` 返回上游 loopback URL，不新建宿主 UI。
已有观察 worker 可复用，查看不会强制中断采集；`check` 不提交模型 turn。
reader 升级 observer 时，在完整生命周期锁与身份核验下复用原端口、创建新 worker generation，
使既有 MCP 固定 URL 对应的端口保持不变；若原端口被占则返回 `EADDRINUSE`，不随机回退或接管占用者。
`stop` 仅停止拥有的 worker，仍启用的原生桥接之后可能重启它；`disable` 使旧 Hooks 失效。
不导入 SwitchAI 源码，不迁移其私有配置、数据或原生历史；现有 SwitchAI 接入保持不变。

端口补丁前已有 Runtime 27 项通过记录；补丁后的两项真实本机测试分别验证同端口新 generation 和
端口占用时的 `EADDRINUSE` 拒绝行为，均通过。这是两批独立执行，不能合并为新源码的一次全量通过结果。
最终 ZIP 的实际解压包 smoke 七项全部通过，退出 0，证据为 `.ui_test/memory-smoke-port-final/result.json`；
持久 MCP 连接升级测试通过，七个适配文件哈希与最终 ZIP 一致。补丁前的采集与原生发现另记，
细节以报告为准。没有访问真实上游模型或业务服务。
开发夹具见 [smoke](../tests/fixtures/memory_smoke.py)、[采集](../tests/fixtures/memory_capture.py)及
[原生初始化](../tests/fixtures/memory_native.py)，端口回归见 [Runtime 测试](../tests/memory-runtime.test.cjs)；
开发 Python/SDK 依赖不进入目标运行包。

源码台账已包含双端 `vault-memory`，源码收录不代表离线发行；发行状态以组件目录和不可变记录为准。
Impeccable、Playwright 保持已有发行状态，claude-mem 仍按本地验证候选管理。
Paperclip/Hermes 仅为宿主参考，不是 Vault 内容。

## 已验证 Playwright 运行边界

The implemented project lifecycle uses explicit `install`, `check`, then `enable`;
`status`, `disable` and `uninstall` are separate actions. Runtime versions are
immutable and shared under `%LOCALAPPDATA%/AgentPluginSkillVault/components/playwright-test/1.0.0`
by default; `-RuntimeRoot` selects another cache base. Each project's scenarios,
fixtures and run evidence live in `.agent-vault-tests`, separate from that cache.
Uninstall retains scenarios, reports, personal files and the shared runtime.
Claude Code receives `.claude/skills/vault-playwright`, three namespaced native
`vault-playwright-test-*` agents, and project `.mcp.json`; Codex receives
`.agents/skills/vault-playwright`, role references only, and project
`.codex/config.toml`. Both register MCP `vault_playwright`. These actions do not
call a model, enable Hooks, change global settings or grant native project trust.

Source inventory: `registry/artifacts.json`. Offline catalog:
`registry/components.json` (Impeccable and Playwright both recommend local
version 1.0.0). Immutable archive records:
`registry/releases/<id>/<version>/<platform>.json`. Binary archives stay under
ignored `dist/components/` locally and need separate distribution. Source commits
do not upload binary releases; only recorded real URLs may be advertised.
`.gitattributes` preserves upstream bytes and pins component-source LF endings;
both releases have Git checkout rebuild evidence; the Playwright result above is
separate from the earlier Impeccable verification.

Impeccable's target management uses Windows PowerShell without separate
Python/Node. Playwright management uses PowerShell and its bundled Node; the target
does not install npm packages. Python build/test tools run on the development
host. Existing Impeccable checks:

```powershell
python -B -m unittest discover -s tests -p 'test_impeccable_component.py' -v
python -B scripts/validate-components.py
```

Set `VAULT_IMPECCABLE_ENGINE` to the verified native executable to include the real
engine/launcher check. Without it that check is explicitly skipped. On this host
the default C: temporary directory fails minimal rename operations; verification
uses ignored `.ui_test/tmp` via task-local TEMP/TMP. This is a recorded environment
limit, not a reason to replace atomic publication with unsafe file copies.

Focused Playwright developer checks:

```powershell
python -B -m unittest discover -s tests -p 'test_playwright_build.py' -v
node --test tests/playwright-management.test.cjs tests/playwright-demo.test.cjs
python -B -m unittest discover -s tests -p 'test_component_registry.py' -v
```

The recorded Playwright verification includes 34 Node tests passed, 23 builder tests passed
and one Windows symlink-privilege skip, plus three registry tests passed. The
installed browser demo kept the same seven cases: broken application 5 passed /
2 failed (TC04/TC05, exit 1), repaired application 7 passed (exit 0). Each run
retained 11 screenshots, seven videos and seven traces. These are focused local
checks, not a full repository test-suite result or company acceptance.

All five native fixture checks passed: management, Claude discovery, MCP protocol,
Codex configuration and Codex Skill discovery. Actual clients were Claude
2.1.317 and Codex 0.167.0-alpha.4.1; both also discovered Impeccable. Initialization
and discovery sent no model turn and do not prove autonomous model selection.
The developer fixture `tests/fixtures/playwright_native.py` imports development
SDK libraries (`claude_agent_sdk`, `mcp`, `pywin32`), not SwitchAI source. These
Python dependencies belong to developer verification; the standalone target
package runs with PowerShell and bundled Node, with no Python dependency.

SwitchAI still manages its existing Playwright and claude-mem ZIPs with dedicated
code. Its integration, private settings and data are unchanged. Vault's new
Playwright adapter is separate; it does not migrate SwitchAI's testing workspace
or memory functionality. Its UI can later consume a versioned component interface;
no SwitchAI host integration is part of this release.
Autonomous model selection and company workflow acceptance require separate
validation; native capability discovery and local replay do not prove them.
