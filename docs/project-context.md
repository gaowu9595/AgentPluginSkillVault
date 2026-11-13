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

The controller's final run recorded 34 Node tests passed, 23 builder tests passed
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
